import { type ChildProcessByStdio, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { type RuntimeInstanceSummary, runtimeInstanceSummarySchema } from "@openducktor/contracts";
import { Cause, Clock, Effect, Exit, Option, Scope } from "effect";
import {
  type HostError,
  HostOperationError,
  HostResourceError,
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
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import type {
  RuntimeEnsureWorkspaceInput,
  RuntimeWorkspaceStarterPort,
} from "../../ports/runtime-registry-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import type { OpenCodeLiveSessionAdapterPreparer } from "../agent-sessions/opencode-live-session-adapter";
import { resolveOpenDucktorMcpCommand } from "../mcp/openducktor-mcp-command";
import { buildOpenDucktorMcpBridgeEnvironment } from "../mcp/openducktor-mcp-environment";
import type { HostRuntimeDistribution } from "../runtimes/runtime-distribution";
import { startOpenCodeLiveSessionState } from "./opencode-live-session-startup";
import { isOpenCodeHealthy, pickFreePort } from "./opencode-local-port";

export type OpenCodeMcpBridgeConnection = {
  workspaceId: string;
  hostUrl: string;
  hostToken: string;
};

export type OpenCodeMcpBridgeConnectionResolver = (
  input: RuntimeEnsureWorkspaceInput,
) => Effect.Effect<OpenCodeMcpBridgeConnection, HostOperationError | HostResourceError>;

type LocalPortAllocator = () => Effect.Effect<number, HostOperationError>;

type OpenCodeReadinessProbe = (
  port: number,
  timeoutMs: number,
) => Effect.Effect<boolean, HostOperationError>;

export type CreateOpenCodeWorkspaceRuntimeStarterInput = {
  toolDiscovery: ToolDiscoveryPort;
  runtimeDistribution: HostRuntimeDistribution;
  liveSessionLifecycle: RuntimeLiveSessionLifecyclePort;
  prepareLiveSessionAdapter: OpenCodeLiveSessionAdapterPreparer;
  resolveMcpBridgeConnection?: OpenCodeMcpBridgeConnectionResolver;
  processEnv?: NodeJS.ProcessEnv;
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
const buildOpenCodeConfigContent = (
  bridge: OpenCodeMcpBridgeConnection,
  mcpCommand: string[],
): string =>
  JSON.stringify({
    logLevel: "INFO",
    mcp: {
      openducktor: {
        type: "local",
        enabled: true,
        command: mcpCommand,
        environment: buildOpenDucktorMcpBridgeEnvironment(bridge, "OpenCode"),
      },
    },
  });

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

const buildManagedOpenCodeEnvironment = (
  processEnv: NodeJS.ProcessEnv,
  configContent: string,
): NodeJS.ProcessEnv => {
  const runtimeEnv: NodeJS.ProcessEnv = {
    ...processEnv,
    OPENCODE_CONFIG_CONTENT: configContent,
  };
  delete runtimeEnv.OPENCODE_SERVER_PASSWORD;
  delete runtimeEnv.OPENCODE_SERVER_USERNAME;
  return runtimeEnv;
};

export const createOpenCodeWorkspaceRuntimeStarter = ({
  toolDiscovery,
  resolveMcpBridgeConnection,
  runtimeDistribution,
  liveSessionLifecycle,
  prepareLiveSessionAdapter,
  processEnv = process.env,
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
}: CreateOpenCodeWorkspaceRuntimeStarterInput): RuntimeWorkspaceStarterPort => ({
  startWorkspaceRuntime(input) {
    let scope: Parameters<typeof Scope.close>[0] | null = null;
    return Effect.gen(function* () {
      if (input.runtimeKind !== "opencode") {
        return yield* Effect.fail(
          new HostValidationError({
            field: "runtimeKind",
            message: `OpenCode workspace runtime starter does not support runtime kind ${input.runtimeKind}.`,
            details: { runtimeKind: input.runtimeKind },
          }),
        );
      }
      if (!resolveMcpBridgeConnection) {
        return yield* Effect.fail(
          new HostResourceError({
            resource: "mcpBridgeConnection",
            operation: "opencodeWorkspaceRuntime.startWorkspaceRuntime",
            message: "OpenCode workspace startup requires an MCP host bridge connection.",
          }),
        );
      }

      const bridge = yield* resolveMcpBridgeConnection(input).pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "opencodeWorkspaceRuntime.resolveMcpBridgeConnection"),
        ),
      );
      const resolvedMcpCommand = yield* resolveOpenDucktorMcpCommand({
        runtimeDistribution,
        toolDiscovery,
      });
      const configContent = yield* Effect.try({
        try: () => buildOpenCodeConfigContent(bridge, resolvedMcpCommand),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
            details: { runtimeKind: input.runtimeKind },
          }),
      });
      const binary = yield* toolDiscovery.resolveToolPath("opencode");
      const port = yield* portAllocator().pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "opencodeWorkspaceRuntime.pickFreePort"),
        ),
      );
      const runtimeEnv = buildManagedOpenCodeEnvironment(processEnv, configContent);
      const command = createProcessCommandLaunch(
        binary,
        ["serve", "--hostname", "127.0.0.1", "--port", port.toString()],
        runtimeEnv,
        platform,
      );
      const nextRuntimeId = runtimeId();
      const runtimeScope = yield* Scope.make();
      scope = runtimeScope;
      const child = yield* Effect.try({
        try: () =>
          spawn(command.command, command.args, {
            cwd: input.workingDirectory,
            detached: shouldStartDetachedProcessGroup(platform),
            env: command.env,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: command.windowsHide,
            windowsVerbatimArguments: command.windowsVerbatimArguments,
          }) as OpenCodeChildProcess,
        catch: (cause) =>
          toHostOperationError(cause, "opencodeWorkspaceRuntime.spawn", {
            binary,
            workingDirectory: input.workingDirectory,
          }),
      });
      const pid = child.pid;
      if (!pid || pid <= 0) {
        return yield* Effect.fail(
          new HostOperationError({
            operation: "opencodeWorkspaceRuntime.startWorkspaceRuntime",
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
      let liveSessionRegistered = false;
      let liveSessionReleasePromise: Promise<Exit.Exit<void, HostError>> | null = null;

      const requestLiveSessionRelease = (): Promise<Exit.Exit<void, HostError>> | null => {
        if (!liveSessionRegistered) {
          return null;
        }
        if (!liveSessionReleasePromise) {
          liveSessionReleasePromise = Effect.runPromiseExit(
            liveSessionLifecycle.releaseRuntime(nextRuntimeId).pipe(Effect.asVoid),
          );
        }
        return liveSessionReleasePromise;
      };
      const awaitLiveSessionRelease = (): Effect.Effect<void, HostOperationError> =>
        Effect.suspend(() => {
          const releasePromise = requestLiveSessionRelease();
          if (!releasePromise) {
            return Effect.void;
          }
          return Effect.promise(() => releasePromise).pipe(
            Effect.flatMap((exit) =>
              Exit.isFailure(exit)
                ? Effect.fail(
                    new HostOperationError({
                      operation: "opencodeWorkspaceRuntime.releaseLiveSessionState",
                      message: Cause.pretty(exit.cause),
                      details: { runtimeId: nextRuntimeId },
                    }),
                  )
                : Effect.void,
            ),
          );
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
        closeDescription =
          signal === null
            ? `process exited with code ${exitCode}`
            : `process exited from signal ${signal}`;
        requestLiveSessionRelease();
      });
      const stopRuntimeProcess = (operation: string) =>
        processTreeTerminator({
          pid,
          label: `OpenCode runtime on 127.0.0.1:${port}`,
          isClosed: () => closed,
          waitForExit: (timeoutMs) => waitForChildProcessClose(child, () => closed, timeoutMs),
          stopTimeoutMs,
        }).pipe(Effect.mapError((cause) => toHostOperationError(cause, operation)));
      let released = false;
      const closeRuntime = (operation = "opencodeWorkspaceRuntime.stop") =>
        Effect.gen(function* () {
          if (released) {
            return;
          }
          released = true;
          yield* stopRuntimeProcess(operation);
        });
      yield* Scope.addFinalizer(runtimeScope, closeRuntime().pipe(Effect.ignore));

      const closeRuntimeAfterStartupTimeout = closeRuntime(
        "opencodeWorkspaceRuntime.stopTimedOutProcess",
      );
      const stopRuntime = closeRuntime();
      const stopRuntimeAndReleaseLiveState = Effect.gen(function* () {
        const liveStateExit = yield* Effect.exit(awaitLiveSessionRelease());
        const processExit = yield* Effect.exit(stopRuntime);
        yield* Scope.close(runtimeScope, Exit.succeed(undefined)).pipe(Effect.ignore);
        const failures = [liveStateExit, processExit]
          .filter(Exit.isFailure)
          .map((exit) => Cause.pretty(exit.cause));
        if (failures.length > 0) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "opencodeWorkspaceRuntime.stop",
              message: failures.join("\n"),
              details: { runtimeId: nextRuntimeId, failures },
            }),
          );
        }
      });

      const remainingStartupTime = () =>
        Effect.map(Clock.currentTimeMillis, (currentTimeMs) =>
          Math.max(0, startupTimeoutMs - (currentTimeMs - startupStartedAtMs)),
        );
      while (true) {
        if (spawnError) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "opencodeWorkspaceRuntime.startWorkspaceRuntime",
              message: `Failed to start OpenCode runtime with ${binary}`,
              cause: spawnError,
              details: { binary },
            }),
          );
        }
        if (closed) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "opencodeWorkspaceRuntime.startWorkspaceRuntime",
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
          Effect.mapError((cause) =>
            toHostOperationError(cause, "opencodeWorkspaceRuntime.probeReadiness"),
          ),
          Effect.timeoutOption(`${remainingProbeTimeMs} millis`),
        );
        if (Option.isNone(readiness)) {
          break;
        }
        if (readiness.value) {
          const runtime = yield* Effect.try({
            try: () =>
              runtimeInstanceSummarySchema.parse({
                kind: "opencode",
                runtimeId: nextRuntimeId,
                repoPath: input.repoPath,
                taskId: null,
                role: "workspace",
                workingDirectory: input.workingDirectory,
                runtimeRoute: {
                  type: "local_http",
                  endpoint: `http://127.0.0.1:${port}`,
                },
                startedAt: now().toISOString(),
                descriptor: input.descriptor,
              } satisfies RuntimeInstanceSummary),
            catch: (cause) =>
              new HostValidationError({
                message: cause instanceof Error ? cause.message : String(cause),
                cause,
                details: { runtimeKind: input.runtimeKind, port },
              }),
          });

          const remainingStartupMs = yield* remainingStartupTime();
          if (remainingStartupMs === 0) {
            return yield* Effect.fail(
              new HostOperationError({
                operation: "opencodeWorkspaceRuntime.startWorkspaceRuntime",
                message: `Timed out starting OpenCode runtime on 127.0.0.1:${port} after ${startupTimeoutMs}ms.`,
                details: { port, startupTimeoutMs },
              }),
            );
          }
          yield* startOpenCodeLiveSessionState({
            runtime,
            runtimeId: nextRuntimeId,
            prepareLiveSessionAdapter,
            liveSessionLifecycle,
            isRuntimeClosed: () => closed,
            closeDescription: () => closeDescription,
            markRegistered: () => {
              liveSessionRegistered = true;
            },
            releaseLiveSessionState: awaitLiveSessionRelease(),
          }).pipe(
            Effect.timeoutFail({
              duration: `${remainingStartupMs} millis`,
              onTimeout: () =>
                new HostOperationError({
                  operation: "opencodeWorkspaceRuntime.startWorkspaceRuntime",
                  message: `Timed out starting OpenCode runtime on 127.0.0.1:${port} after ${startupTimeoutMs}ms.`,
                  details: { port, startupTimeoutMs },
                }),
            }),
          );

          return {
            runtime,
            isAlive() {
              return !closed;
            },
            stop() {
              return stopRuntimeAndReleaseLiveState.pipe(
                Effect.mapError((cause) =>
                  toHostOperationError(cause, "opencodeWorkspaceRuntime.stop"),
                ),
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

      const timeoutMessage = `Timed out waiting for OpenCode runtime on 127.0.0.1:${port}.`;
      const cleanupExit = yield* Effect.either(closeRuntimeAfterStartupTimeout);
      if (cleanupExit._tag === "Left") {
        return yield* Effect.fail(
          new HostOperationError({
            operation: "opencodeWorkspaceRuntime.startWorkspaceRuntime",
            message: `${timeoutMessage} Cleanup failed: ${cleanupExit.left.message}`,
            cause: cleanupExit.left,
            details: { port, startupTimeoutMs },
          }),
        );
      }
      return yield* Effect.fail(
        new HostOperationError({
          operation: "opencodeWorkspaceRuntime.startWorkspaceRuntime",
          message: timeoutMessage,
          details: { port, startupTimeoutMs },
        }),
      );
    }).pipe(
      Effect.onError(() =>
        scope ? Scope.close(scope, Exit.fail("startup failed")).pipe(Effect.ignore) : Effect.void,
      ),
    );
  },
});
