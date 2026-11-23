import { type ChildProcessByStdio, spawn } from "node:child_process";
import {
  type ClientApp,
  type ClientConnection,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  client,
  type InitializeResponse,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from "@agentclientprotocol/sdk/unstable";
import { Effect } from "effect";
import {
  HostOperationError,
  type HostOperationErrorAggregate,
  toHostOperationError,
} from "../../effect/host-errors";
import { trackManagedProcess } from "../../infrastructure/process/managed-processes";
import {
  type ProcessTreePlatform,
  type ProcessTreeTerminator,
  processTreeIsAlive,
  shouldStartDetachedProcessGroup,
  terminateProcessTree,
  waitForChildProcessClose,
} from "../../infrastructure/process/process-tree";
import type { Readable, Writable } from "node:stream";
import { createRuntimeLaunch } from "../../infrastructure/process/runtime-launch";
import {
  ANTIGRAVITY_CLIENT_CAPABILITIES,
  describeAntigravityRequestError,
} from "./antigravity-native-contract";

type AntigravityChildProcess = ChildProcessByStdio<Writable, Readable, Readable>;

/** What the Antigravity process asks of OpenDucktor. Session updates arrive in order. */
export type AntigravityClientHandlers = {
  readonly sessionUpdate: (notification: SessionNotification) => void;
  readonly requestPermission: (
    params: RequestPermissionRequest,
    signal: AbortSignal,
  ) => Promise<RequestPermissionResponse>;
  readonly createElicitation: (
    params: CreateElicitationRequest,
    signal: AbortSignal,
  ) => Promise<CreateElicitationResponse>;
};

export type AntigravityAcpProcess = {
  readonly child: AntigravityChildProcess;
  readonly connection: ClientConnection;
  /** The last lines that the process wrote to stderr. */
  readonly stderrTail: () => string;
  readonly isClosed: () => boolean;
  /** How the process stopped, once it stopped. */
  readonly closeDescription: () => string | null;
};

const STDERR_TAIL_LIMIT = 4_000;

/** The ACP client of OpenDucktor. It answers the requests that Antigravity sends to a client. */
export const createAntigravityClientApp = (handlers: AntigravityClientHandlers): ClientApp =>
  client({ name: "openducktor" })
    .onNotification(methods.client.session.update, ({ params }) => handlers.sessionUpdate(params))
    .onRequest(methods.client.session.requestPermission, ({ params, signal }) =>
      handlers.requestPermission(params, signal),
    )
    .onRequest(methods.client.elicitation.create, ({ params, signal }) =>
      handlers.createElicitation(params, signal),
    );

/**
 * Starts `agy acp` with no flags, so the native sandbox and permission settings apply, and
 * connects an ACP client to its stdio.
 */
export const spawnAntigravityAcp = ({
  executablePath,
  env,
  cwd,
  handlers,
  platform = process.platform,
}: {
  executablePath: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
  handlers: AntigravityClientHandlers;
  platform?: ProcessTreePlatform;
}): AntigravityAcpProcess => {
  // Antigravity ships a native binary, so no npm shim resolves to it.
  const launch = createRuntimeLaunch(executablePath, ["acp"], env, platform, () => null);
  const child: AntigravityChildProcess = spawn(launch.command, launch.args, {
    cwd,
    detached: shouldStartDetachedProcessGroup(platform),
    env: launch.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: launch.windowsHide,
    windowsVerbatimArguments: launch.windowsVerbatimArguments,
  });
  trackManagedProcess(child, launch.managed);
  let closed = false;
  let closeDescription: string | null = null;
  let stderr = "";
  child.once("close", (exitCode, signal) => {
    closed = true;
    closeDescription =
      signal === null
        ? `process exited with code ${exitCode}`
        : `process exited from signal ${signal}`;
  });
  // A spawn failure, such as a missing executable, closes the process without a close event.
  child.once("error", (error) => {
    closed = true;
    closeDescription ??= `process failed to start: ${error.message}`;
    connection.close(error);
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-STDERR_TAIL_LIMIT);
  });
  // A write after the process exits fails here. The close event reports the exit.
  child.stdin.on("error", () => {});
  const output = new WritableStream<Uint8Array>({
    write: (chunk) =>
      new Promise<void>((resolve, reject) =>
        child.stdin.write(chunk, (error) => (error ? reject(error) : resolve())),
      ),
    close: () => new Promise<void>((resolve) => child.stdin.end(resolve)),
    abort: () => {
      child.stdin.destroy();
    },
  });
  const input = new ReadableStream<Uint8Array>({
    start: (controller) => {
      child.stdout.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      child.stdout.once("end", () => controller.close());
      child.stdout.once("error", (error) => controller.error(error));
    },
    cancel: () => {
      child.stdout.destroy();
    },
  });
  const stream = ndJsonStream(output, input);
  const connection = createAntigravityClientApp(handlers).connect(stream);
  return {
    child,
    connection,
    stderrTail: () => stderr.trim(),
    isClosed: () => closed,
    closeDescription: () => closeDescription,
  };
};

const INITIALIZE_TIMEOUT_MS = 15_000;

/** Runs `initialize`. A slow or closed process fails with what it wrote to stderr. */
export const initializeAntigravityAcp = (
  acp: AntigravityAcpProcess,
  clientVersion: string,
): Effect.Effect<InitializeResponse, HostOperationErrorAggregate> =>
  Effect.tryPromise({
    try: async (): Promise<InitializeResponse> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Antigravity did not answer initialize within ${INITIALIZE_TIMEOUT_MS / 1000} seconds.`,
              ),
            ),
          INITIALIZE_TIMEOUT_MS,
        );
      });
      try {
        return await Promise.race([
          acp.connection.agent.request(methods.agent.initialize, {
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: ANTIGRAVITY_CLIENT_CAPABILITIES,
            clientInfo: { name: "openducktor", title: "OpenDucktor", version: clientVersion },
          }),
          timeout,
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
    catch: (cause) => {
      const stderr = acp.stderrTail();
      const message = describeAntigravityRequestError(cause);
      return new HostOperationError({
        operation: "antigravity.initialize",
        message: stderr ? `${message} Antigravity output: ${stderr}` : message,
        cause,
      });
    },
  });

const STOP_TIMEOUT_MS = 3_000;

/** Closes the ACP connection and stops the process tree. */
export const stopAntigravityAcp = (
  acp: AntigravityAcpProcess,
  label: string,
  platform: ProcessTreePlatform = process.platform,
  processTreeTerminator: ProcessTreeTerminator = terminateProcessTree,
): Effect.Effect<void, HostOperationErrorAggregate> =>
  Effect.gen(function* () {
    acp.connection.close();
    // The child closes only after its stdin closes.
    acp.child.stdin.end();
    const pid = acp.child.pid;
    if (pid === undefined || pid <= 0) return;
    yield* processTreeTerminator({
      pid,
      label,
      isClosed: () => acp.isClosed() && !processTreeIsAlive(pid, platform),
      waitForExit: (timeoutMs) => waitForChildProcessClose(acp.child, acp.isClosed, timeoutMs),
      stopTimeoutMs: STOP_TIMEOUT_MS,
    }).pipe(Effect.mapError((cause) => toHostOperationError(cause, "antigravity.stopProcess")));
  });
