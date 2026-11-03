import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Cause, Effect, Exit } from "effect";
import { z } from "zod";
import {
  HostOperationError,
  type HostOperationErrorAggregate,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import { createProcessCommandLaunch } from "../../infrastructure/process/process-command-launch";
import {
  type ProcessTreePlatform,
  type ProcessTreeTerminator,
  shouldStartDetachedProcessGroup,
  terminateProcessTree,
  waitForChildProcessClose,
} from "../../infrastructure/process/process-tree";
import {
  RuntimeExecutableIncompatibleError,
  type RuntimeExecutableProbeError,
  type RuntimeExecutableProbePort,
} from "../../ports/runtime-executable-probe-port";
import { runtimeExecutableStartFailureMessage } from "../runtimes/runtime-executable-guidance";
import { useRuntimeProbeResource } from "../runtimes/runtime-executable-probe-lifecycle";
import { createCodexAppServerTransport } from "./codex-app-server-transport";
import type {
  CodexAppServerChildTransport,
  CodexTransportBaseError,
} from "./codex-app-server-transport-types";
import type { CodexChildProcess } from "./codex-runtime-cleanup";

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_STOP_TIMEOUT_MS = 3_000;

type CodexProbeTransport = Pick<
  CodexAppServerChildTransport,
  "close" | "notify" | "rejectPendingRequestsForShutdown" | "request"
>;

const capturedStderrSchema = z.object({ stderr: z.string().min(1) });

/** Prefers the stderr of a Codex process that closed, because it names the startup problem. */
const codexFailureDetail = (cause: CodexTransportBaseError): string => {
  const details = capturedStderrSchema.safeParse(cause.details);
  return details.success ? details.data.stderr : cause.message;
};

export const verifyCodexAppServerProtocol = (
  transport: CodexProbeTransport,
  clientVersion: string,
  executablePath: string,
): Effect.Effect<void, RuntimeExecutableProbeError> =>
  Effect.gen(function* () {
    yield* transport.request({
      method: "initialize",
      params: {
        clientInfo: {
          name: "openducktor",
          title: "OpenDucktor",
          version: clientVersion,
        },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
          optOutNotificationMethods: [],
        },
      },
    });
    yield* transport.notify({ method: "initialized" });
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof HostValidationError
        ? new RuntimeExecutableIncompatibleError({
            message:
              "The executable did not complete the Codex app-server initialization protocol.",
            cause,
          })
        : new HostOperationError({
            operation: "codexExecutableProbe.initialize",
            message: runtimeExecutableStartFailureMessage(
              "codex",
              executablePath,
              codexFailureDetail(cause),
            ),
            cause,
            details: { executablePath },
          }),
    ),
  );

const cleanupCodexProbe = ({
  child,
  closed,
  pid,
  processTreeTerminator,
  stopTimeoutMs,
  transport,
}: {
  child: CodexChildProcess;
  closed: () => boolean;
  pid: number;
  processTreeTerminator: ProcessTreeTerminator;
  stopTimeoutMs: number;
  transport: CodexProbeTransport;
}): Effect.Effect<void, HostOperationErrorAggregate> =>
  Effect.gen(function* () {
    const pendingExit = yield* Effect.exit(transport.rejectPendingRequestsForShutdown());
    const processExit = yield* Effect.exit(
      processTreeTerminator({
        pid,
        label: "Codex executable probe",
        isClosed: closed,
        waitForExit: (timeoutMs) => waitForChildProcessClose(child, closed, timeoutMs),
        stopTimeoutMs,
      }),
    );
    const transportExit = yield* Effect.exit(transport.close());
    const failures = [pendingExit, processExit, transportExit]
      .filter(Exit.isFailure)
      .map((exit) => Cause.pretty(exit.cause));
    if (failures.length > 0) {
      return yield* Effect.fail(
        new HostOperationError({
          operation: "codexExecutableProbe.cleanup",
          message: failures.join("\n"),
          details: { pid },
        }),
      );
    }
  });

export type CreateCodexExecutableProbeInput = {
  clientVersion?: string;
  readEnv?: () => NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  stopTimeoutMs?: number;
  platform?: ProcessTreePlatform;
  processTreeTerminator?: ProcessTreeTerminator;
};

export const createCodexExecutableProbe = ({
  clientVersion = "0.0.0",
  readEnv = () => process.env,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
  platform = process.platform,
  processTreeTerminator = terminateProcessTree,
}: CreateCodexExecutableProbeInput = {}): RuntimeExecutableProbePort => ({
  probeExecutable(executablePath) {
    return useRuntimeProbeResource({
      acquire: Effect.gen(function* () {
        const command = yield* Effect.try({
          try: () =>
            createProcessCommandLaunch(executablePath, ["app-server"], readEnv(), platform),
          catch: (cause) =>
            toHostOperationError(cause, "codexExecutableProbe.buildCommand", { executablePath }),
        });
        const child = yield* Effect.try({
          try: (): CodexChildProcess =>
            spawn(command.command, command.args, {
              cwd: process.cwd(),
              detached: shouldStartDetachedProcessGroup(platform),
              env: command.env,
              stdio: ["pipe", "pipe", "pipe"],
              windowsHide: command.windowsHide,
              windowsVerbatimArguments: command.windowsVerbatimArguments,
            }),
          catch: (cause) =>
            toHostOperationError(cause, "codexExecutableProbe.spawn", { executablePath }),
        });
        const handleEarlySpawnError = () => undefined;
        child.once("error", handleEarlySpawnError);
        const pid = child.pid;
        if (!pid || pid <= 0) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "codexExecutableProbe.spawn",
              message: `Failed to start Codex app-server with ${executablePath}: child process has no valid pid.`,
              details: { executablePath },
            }),
          );
        }
        let closed = false;
        child.once("close", () => {
          closed = true;
        });
        const transport = createCodexAppServerTransport(
          `executable-probe-${randomUUID()}`,
          child,
          requestTimeoutMs,
          () => undefined,
        );
        child.off("error", handleEarlySpawnError);
        return { child, closed: () => closed, pid, transport };
      }),
      probe: ({ transport }) =>
        verifyCodexAppServerProtocol(transport, clientVersion, executablePath),
      release: ({ child, closed, pid, transport }) =>
        cleanupCodexProbe({
          child,
          closed,
          pid,
          processTreeTerminator,
          stopTimeoutMs,
          transport,
        }),
      cleanupOperation: "codexExecutableProbe.cleanup",
    });
  },
});
