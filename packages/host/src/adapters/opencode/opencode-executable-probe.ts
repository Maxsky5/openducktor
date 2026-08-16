import {
  type ChildProcessByStdio,
  type SpawnOptionsWithStdioTuple,
  type StdioNull,
  type StdioPipe,
  spawn,
} from "node:child_process";
import type { Readable } from "node:stream";
import { Effect } from "effect";
import { HostOperationError, toHostOperationError } from "../../effect/host-errors";
import { createProcessCommandLaunch } from "../../infrastructure/process/process-command-launch";
import {
  type ProcessTreePlatform,
  type ProcessTreeTerminator,
  shouldStartDetachedProcessGroup,
  terminateProcessTree,
  waitForChildProcessClose,
} from "../../infrastructure/process/process-tree";
import type { RuntimeExecutableProbePort } from "../../ports/runtime-executable-probe-port";
import { useRuntimeProbeResource } from "../runtimes/runtime-executable-probe-lifecycle";
import { isOpenCodeHealthy, pickFreePort } from "./opencode-local-port";

const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 250;
const DEFAULT_RETRY_DELAY_MS = 100;
const DEFAULT_STOP_TIMEOUT_MS = 3_000;
const MAX_CAPTURED_OUTPUT_BYTES = 16 * 1024;

type OpenCodeProbeChildProcess = ChildProcessByStdio<null, Readable, Readable>;
type LocalPortAllocator = () => Effect.Effect<number, HostOperationError>;
type OpenCodeReadinessProbe = (port: number, timeoutMs: number) => Effect.Effect<boolean>;
type OpenCodeProbeSpawner = (
  command: string,
  args: string[],
  options: SpawnOptionsWithStdioTuple<StdioNull, StdioPipe, StdioPipe>,
) => OpenCodeProbeChildProcess;

const appendOutput = (current: string, chunk: Buffer): string =>
  `${current}${chunk.toString("utf8")}`.slice(-MAX_CAPTURED_OUTPUT_BYTES);

const processOutputDetail = (stderr: string, stdout: string): string =>
  stderr.trim() || stdout.trim() || "process exited before the health endpoint became ready";

export const buildOpenCodeExecutableProbeEnvironment = (
  processEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    ...processEnv,
    OPENCODE_CONFIG_CONTENT: '{"logLevel":"INFO"}',
  };
  delete env.OPENCODE_SERVER_PASSWORD;
  delete env.OPENCODE_SERVER_USERNAME;
  return env;
};

export type CreateOpenCodeExecutableProbeInput = {
  connectTimeoutMs?: number;
  platform?: ProcessTreePlatform;
  portAllocator?: LocalPortAllocator;
  processEnv?: NodeJS.ProcessEnv;
  processTreeTerminator?: ProcessTreeTerminator;
  readinessProbe?: OpenCodeReadinessProbe;
  retryDelayMs?: number;
  spawnProcess?: OpenCodeProbeSpawner;
  startupTimeoutMs?: number;
  stopTimeoutMs?: number;
};

export const createOpenCodeExecutableProbe = ({
  connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
  platform = process.platform,
  portAllocator = () =>
    pickFreePort().pipe(
      Effect.mapError((cause) => toHostOperationError(cause, "opencodeExecutableProbe.pickPort")),
    ),
  processEnv = process.env,
  processTreeTerminator = terminateProcessTree,
  readinessProbe = isOpenCodeHealthy,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  spawnProcess = (command, args, options) => spawn(command, args, options),
  startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
  stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
}: CreateOpenCodeExecutableProbeInput = {}): RuntimeExecutableProbePort => ({
  probeExecutable(executablePath) {
    return useRuntimeProbeResource({
      acquire: Effect.gen(function* () {
        const port = yield* portAllocator();
        const command = yield* Effect.try({
          try: () =>
            createProcessCommandLaunch(
              executablePath,
              ["serve", "--hostname", "127.0.0.1", "--port", port.toString()],
              buildOpenCodeExecutableProbeEnvironment(processEnv),
              platform,
            ),
          catch: (cause) =>
            toHostOperationError(cause, "opencodeExecutableProbe.buildCommand", {
              executablePath,
              port,
            }),
        });
        const child = yield* Effect.try({
          try: () =>
            spawnProcess(command.command, command.args, {
              cwd: process.cwd(),
              detached: shouldStartDetachedProcessGroup(platform),
              env: command.env,
              stdio: ["ignore", "pipe", "pipe"],
              windowsHide: command.windowsHide,
              windowsVerbatimArguments: command.windowsVerbatimArguments,
            }),
          catch: (cause) =>
            toHostOperationError(cause, "opencodeExecutableProbe.spawn", {
              executablePath,
              port,
            }),
        });
        let spawnError: Error | null = null;
        child.once("error", (error) => {
          spawnError = error;
        });
        const pid = child.pid;
        if (!pid || pid <= 0) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "opencodeExecutableProbe.spawn",
              message: `Failed to start OpenCode server with ${executablePath}: child process has no valid pid.`,
              details: { executablePath, port },
            }),
          );
        }
        let closed = false;
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => {
          stdout = appendOutput(stdout, chunk);
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr = appendOutput(stderr, chunk);
        });
        child.once("close", () => {
          closed = true;
        });
        return {
          child,
          closed: () => closed,
          executablePath,
          pid,
          port,
          spawnError: () => spawnError,
          stderr: () => stderr,
          stdout: () => stdout,
        };
      }),
      probe: (runtime) =>
        Effect.gen(function* () {
          while (true) {
            const spawnError = runtime.spawnError();
            if (spawnError) {
              return yield* Effect.fail(
                new HostOperationError({
                  operation: "opencodeExecutableProbe.startServer",
                  message: `Failed to start OpenCode server with ${runtime.executablePath}.`,
                  cause: spawnError,
                  details: { executablePath: runtime.executablePath, port: runtime.port },
                }),
              );
            }
            if (runtime.closed()) {
              return yield* Effect.fail(
                new HostOperationError({
                  operation: "opencodeExecutableProbe.startServer",
                  message: `OpenCode server exited before it became ready: ${processOutputDetail(
                    runtime.stderr(),
                    runtime.stdout(),
                  )}`,
                  details: { executablePath: runtime.executablePath, port: runtime.port },
                }),
              );
            }
            if (yield* readinessProbe(runtime.port, connectTimeoutMs)) {
              return;
            }
            yield* Effect.sleep(`${retryDelayMs} millis`);
          }
        }).pipe(
          Effect.timeoutFail({
            duration: `${startupTimeoutMs} millis`,
            onTimeout: () =>
              new HostOperationError({
                operation: "opencodeExecutableProbe.startServer",
                message: `Timed out waiting for the OpenCode health endpoint from ${executablePath}.`,
                details: { executablePath, startupTimeoutMs },
              }),
          }),
        ),
      release: (runtime) =>
        processTreeTerminator({
          pid: runtime.pid,
          label: `OpenCode executable probe on 127.0.0.1:${runtime.port}`,
          isClosed: runtime.closed,
          waitForExit: (timeoutMs) =>
            waitForChildProcessClose(runtime.child, runtime.closed, timeoutMs),
          stopTimeoutMs,
        }).pipe(
          Effect.mapError((cause) =>
            toHostOperationError(cause, "opencodeExecutableProbe.stopServer", {
              executablePath,
              port: runtime.port,
            }),
          ),
        ),
      cleanupOperation: "opencodeExecutableProbe.cleanup",
    });
  },
});
