import { type ChildProcessByStdio, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { Clock, Effect, Option } from "effect";
import {
  HostOperationError,
  type HostOperationErrorAggregate,
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
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import type { RuntimeStarterPort } from "../../ports/runtime-registry-port";
import { type ToolDiscoveryPort, validateExactToolPath } from "../../ports/tool-discovery-port";
import type { OpenCodeLiveSessionAdapterPreparer } from "../agent-sessions/opencode-live-session-adapter";
import { withoutOpenDucktorMcpEnvironment } from "../mcp/openducktor-mcp-environment";
import { createRuntimeCleanup } from "../runtimes/runtime-cleanup";
import {
  createLiveSessionAttachment,
  createRuntimeSummary,
} from "../runtimes/runtime-live-session-attachment";
import { isOpenCodeHealthy, pickFreePort } from "./opencode-local-port";

type LocalPortAllocator = () => Effect.Effect<number, HostOperationErrorAggregate>;

type OpenCodeReadinessProbe = (
  port: number,
  timeoutMs: number,
) => Effect.Effect<boolean, HostOperationErrorAggregate>;

export type CreateOpenCodeRuntimeStarterInput = {
  toolDiscovery: ToolDiscoveryPort;
  liveSessionLifecycle: RuntimeLiveSessionLifecyclePort;
  prepareLiveSessionAdapter: OpenCodeLiveSessionAdapterPreparer;
  /** Process working directory of the shared server. Sessions select their own directories. */
  launchDirectory: string;
  readEnv?: () => NodeJS.ProcessEnv;
  startupTimeoutMs?: number;
  connectTimeoutMs?: number;
  retryDelayMs?: number;
  stopTimeoutMs?: number;
  now?: () => Date;
  runtimeId?: () => string;
  portAllocator?: LocalPortAllocator;
  readinessProbe?: OpenCodeReadinessProbe;
  platform?: ProcessTreePlatform;
  processTreeTerminator?: ProcessTreeTerminator;
};

const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 250;
const DEFAULT_RETRY_DELAY_MS = 100;
const DEFAULT_STOP_TIMEOUT_MS = 3_000;
const MAX_CAPTURED_OUTPUT_BYTES = 64 * 1024;

type OpenCodeChildProcess = ChildProcessByStdio<null, Readable, Readable>;

const appendCapturedOutput = (current: string, chunk: Buffer): string => {
  const next = current + chunk.toString("utf8");
  if (next.length <= MAX_CAPTURED_OUTPUT_BYTES) {
    return next;
  }
  return next.slice(next.length - MAX_CAPTURED_OUTPUT_BYTES);
};

const outputDetail = (stderr: string, stdout: string, fallback: string): string => {
  const trimmedStderr = stderr.trim();
  if (trimmedStderr) {
    return trimmedStderr;
  }
  const trimmedStdout = stdout.trim();
  return trimmedStdout || fallback;
};

/**
 * OpenCode merges its process environment into each local MCP server environment.
 * The shared server must not carry the workspace binding of one OpenDucktor MCP server.
 */
const buildManagedOpenCodeEnvironment = (processEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const runtimeEnv = withoutOpenDucktorMcpEnvironment(processEnv);
  delete runtimeEnv.OPENCODE_SERVER_PASSWORD;
  delete runtimeEnv.OPENCODE_SERVER_USERNAME;
  return runtimeEnv;
};

/** Starts the one shared OpenCode server of this host. Every workspace uses it. */
export const createOpenCodeRuntimeStarter = ({
  toolDiscovery,
  liveSessionLifecycle,
  prepareLiveSessionAdapter,
  launchDirectory,
  readEnv = () => process.env,
  startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
  connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
  now = () => new Date(),
  runtimeId = () => randomUUID(),
  portAllocator = () =>
    pickFreePort().pipe(
      Effect.mapError((cause) => toHostOperationError(cause, "opencodeRuntime.pickFreePort")),
    ),
  readinessProbe = (port, timeoutMs) =>
    isOpenCodeHealthy(port, timeoutMs).pipe(
      Effect.mapError((cause) =>
        toHostOperationError(cause, "opencodeRuntime.probeReadiness", {
          port,
          timeoutMs,
        }),
      ),
    ),
  platform = process.platform,
  processTreeTerminator = terminateProcessTree,
}: CreateOpenCodeRuntimeStarterInput): RuntimeStarterPort => ({
  startRuntime(input) {
    return Effect.gen(function* () {
      const { path: binary } = yield* validateExactToolPath(
        toolDiscovery,
        "opencode",
        input.configuredExecutablePath,
      );
      const port = yield* portAllocator().pipe(
        Effect.mapError((cause) => toHostOperationError(cause, "opencodeRuntime.pickFreePort")),
      );
      const runtimeEnv = buildManagedOpenCodeEnvironment(readEnv());
      const command = createProcessCommandLaunch(
        binary,
        ["serve", "--hostname", "127.0.0.1", "--port", port.toString()],
        runtimeEnv,
        platform,
      );
      const nextRuntimeId = runtimeId();
      const child = yield* Effect.try({
        try: (): OpenCodeChildProcess =>
          spawn(command.command, command.args, {
            cwd: launchDirectory,
            detached: shouldStartDetachedProcessGroup(platform),
            env: command.env,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: command.windowsHide,
            windowsVerbatimArguments: command.windowsVerbatimArguments,
          }),
        catch: (cause) =>
          toHostOperationError(cause, "opencodeRuntime.spawn", {
            binary,
            launchDirectory,
          }),
      });
      const pid = child.pid;
      if (!pid || pid <= 0) {
        return yield* Effect.fail(
          new HostOperationError({
            operation: "opencodeRuntime.startRuntime",
            message: "Failed to start OpenCode runtime: child process has no valid pid.",
          }),
        );
      }
      const startupStartedAtMs = yield* Clock.currentTimeMillis;

      let closed = false;
      let closeDescription: string | null = null;
      let spawnError: Error | null = null;
      let stdout = "";
      let stderr = "";
      let startupCompleted = false;
      let stopRequested = false;
      let exitMessage: string | null = null;
      let lossBeforeStartup: string | null = null;
      /** Reports one unexpected end of this runtime generation after startup. */
      const reportRuntimeExit = (message: string): void => {
        if (stopRequested || exitMessage !== null) {
          return;
        }
        if (!startupCompleted) {
          lossBeforeStartup ??= message;
          return;
        }
        exitMessage = message;
        input.onRuntimeExit(message);
      };
      /** Adds a failed cleanup to the reported loss. A stop reports its own cleanup outcome. */
      const reportCleanupFailure = (cause: string): void => {
        if (stopRequested || exitMessage === null) {
          return;
        }
        input.onRuntimeCleanupFailed(cause);
      };
      const liveSession = createLiveSessionAttachment({
        runtimeId: nextRuntimeId,
        runtimeLabel: "OpenCode",
        operationPrefix: "opencodeRuntime",
        lifecycle: liveSessionLifecycle,
        isClosed: () => closed,
        closeDescription: () => closeDescription,
      });

      child.stdout.on("data", (chunk: Buffer) => {
        stdout = appendCapturedOutput(stdout, chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = appendCapturedOutput(stderr, chunk);
      });
      child.once("error", (error: Error) => {
        spawnError = error;
      });
      child.once("close", (exitCode, signal) => {
        closed = true;
        const description =
          signal === null
            ? `process exited with code ${exitCode}`
            : `process exited from signal ${signal}`;
        closeDescription = description;
        const output = stderr.trim() || stdout.trim();
        reportRuntimeExit(output ? `${description}. Last output: ${output}` : `${description}.`);
        Effect.runFork(
          liveSession.release.pipe(
            Effect.catch((cause) => Effect.sync(() => reportCleanupFailure(cause.message))),
          ),
        );
      });
      const stopRuntimeProcess = (operation: string) =>
        processTreeTerminator({
          pid,
          label: `OpenCode runtime on 127.0.0.1:${port}`,
          isClosed: () => closed,
          waitForExit: (timeoutMs) => waitForChildProcessClose(child, () => closed, timeoutMs),
          stopTimeoutMs,
        }).pipe(Effect.mapError((cause) => toHostOperationError(cause, operation)));
      // A failed stop keeps the unfinished steps, so a later explicit action can finish them.
      const stopRuntimeAndReleaseLiveState = createRuntimeCleanup({
        runtimeId: nextRuntimeId,
        operation: "opencodeRuntime.stop",
        releaseLiveState: liveSession.release,
        stopProcess: Effect.suspend(() => stopRuntimeProcess("opencodeRuntime.stop")),
        onStart: () => {
          stopRequested = true;
        },
      });

      // The host owns this process and its live state from here until startup returns its handle.
      // A failed start leaves their cleanup to the host.
      input.ownCleanup(stopRuntimeAndReleaseLiveState);

      const remainingStartupTime = () =>
        Effect.map(Clock.currentTimeMillis, (currentTimeMs) =>
          Math.max(0, startupTimeoutMs - (currentTimeMs - startupStartedAtMs)),
        );
      while (true) {
        if (spawnError) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "opencodeRuntime.startRuntime",
              message: `Failed to start OpenCode runtime with ${binary}`,
              cause: spawnError,
              details: { binary },
            }),
          );
        }
        if (closed) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "opencodeRuntime.startRuntime",
              message: `OpenCode process exited before runtime became reachable: ${outputDetail(
                stderr,
                stdout,
                closeDescription ?? "process exited",
              )}`,
              details: { binary, stdout, stderr, closeDescription },
            }),
          );
        }
        const remainingProbeTimeMs = yield* remainingStartupTime();
        if (remainingProbeTimeMs === 0) {
          break;
        }
        const readiness = yield* readinessProbe(port, connectTimeoutMs).pipe(
          Effect.mapError((cause) => toHostOperationError(cause, "opencodeRuntime.probeReadiness")),
          Effect.timeoutOption(`${remainingProbeTimeMs} millis`),
        );
        if (Option.isNone(readiness)) {
          break;
        }
        if (readiness.value) {
          const runtime = yield* createRuntimeSummary({
            kind: "opencode",
            runtimeId: nextRuntimeId,
            runtimeRoute: { type: "local_http", endpoint: `http://127.0.0.1:${port}` },
            descriptor: input.descriptor,
            startedAt: now(),
          });

          const remainingStartupMs = yield* remainingStartupTime();
          if (remainingStartupMs === 0) {
            return yield* Effect.fail(
              new HostOperationError({
                operation: "opencodeRuntime.startRuntime",
                message: `Timed out starting OpenCode runtime on 127.0.0.1:${port} after ${startupTimeoutMs}ms.`,
                details: { port, startupTimeoutMs },
              }),
            );
          }
          yield* Effect.gen(function* () {
            const prepared = yield* prepareLiveSessionAdapter(runtime, {
              onObservationLost: reportRuntimeExit,
              onCleanupFailed: reportCleanupFailure,
            }).pipe(
              Effect.mapError((cause) =>
                toHostOperationError(cause, "opencodeRuntime.prepareLiveSessionAdapter", {
                  runtimeId: nextRuntimeId,
                }),
              ),
            );
            liveSession.adopt(prepared);
            yield* liveSession.attach;
          }).pipe(
            Effect.timeoutOrElse({
              duration: `${remainingStartupMs} millis`,
              orElse: () =>
                Effect.fail(
                  new HostOperationError({
                    operation: "opencodeRuntime.startRuntime",
                    message: `Timed out starting OpenCode runtime on 127.0.0.1:${port} after ${startupTimeoutMs}ms.`,
                    details: { port, startupTimeoutMs },
                  }),
                ),
            }),
          );

          if (lossBeforeStartup !== null) {
            return yield* Effect.fail(
              new HostOperationError({
                operation: "opencodeRuntime.startRuntime",
                message: `OpenCode runtime on 127.0.0.1:${port} lost live observation during startup: ${lossBeforeStartup}`,
                details: { port },
              }),
            );
          }
          startupCompleted = true;
          return {
            runtime,
            configuredExecutablePath: input.configuredExecutablePath,
            effectiveExecutablePath: binary,
            stop() {
              return stopRuntimeAndReleaseLiveState.pipe(
                Effect.mapError((cause) => toHostOperationError(cause, "opencodeRuntime.stop")),
              );
            },
          };
        }

        const remainingDelayTimeMs = yield* remainingStartupTime();
        if (remainingDelayTimeMs === 0) {
          break;
        }
        yield* Effect.sleep(`${Math.min(retryDelayMs, remainingDelayTimeMs)} millis`);
      }

      return yield* Effect.fail(
        new HostOperationError({
          operation: "opencodeRuntime.startRuntime",
          message: `Timed out waiting for OpenCode runtime on 127.0.0.1:${port}.`,
          details: { port, startupTimeoutMs },
        }),
      );
    });
  },
});
