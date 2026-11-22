import { randomUUID } from "node:crypto";
import { Effect, Fiber } from "effect";
import {
  HostValidationError,
  type HostOperationErrorAggregate,
  toHostOperationError,
} from "../../effect/host-errors";
import { RuntimeExecutableIncompatibleError } from "../../ports/runtime-executable-probe-port";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import type { RuntimeStarterPort } from "../../ports/runtime-registry-port";
import { type ToolDiscoveryPort, validateExactToolPath } from "../../ports/tool-discovery-port";
import type { AntigravityLiveSessionAdapterPreparer } from "../agent-sessions/antigravity-live-session-adapter";
import { withoutOpenDucktorMcpEnvironment } from "../mcp/openducktor-mcp-environment";
import { createRuntimeCleanup } from "../runtimes/runtime-cleanup";
import {
  createLiveSessionAttachment,
  createRuntimeSummary,
} from "../runtimes/runtime-live-session-attachment";
import {
  type AntigravityAcpProcess,
  spawnAntigravityAcp,
  stopAntigravityAcp,
} from "./antigravity-acp-process";
import { verifyAntigravityAcp } from "./antigravity-executable-probe";

const CONNECTION_CLOSED = "closed its ACP connection";

export type CreateAntigravityRuntimeStarterInput = {
  toolDiscovery: ToolDiscoveryPort;
  liveSessionLifecycle: RuntimeLiveSessionLifecyclePort;
  prepareLiveSessionAdapter: AntigravityLiveSessionAdapterPreparer;
  /** The shared process belongs to no repository, so it starts in the user home directory. */
  launchDirectory: string;
  readEnv: () => NodeJS.ProcessEnv;
  clientVersion?: string;
  now?: () => Date;
  runtimeId?: () => string;
};

/**
 * Starts the one shared `agy acp` process of this host. It owns the process, the ACP connection,
 * and the live adapter through one cleanup path.
 */
export const createAntigravityRuntimeStarter = ({
  toolDiscovery,
  liveSessionLifecycle,
  prepareLiveSessionAdapter,
  launchDirectory,
  readEnv,
  clientVersion = readEnv().npm_package_version ?? "0.0.0",
  now = () => new Date(),
  runtimeId = () => randomUUID(),
}: CreateAntigravityRuntimeStarterInput): RuntimeStarterPort => ({
  startRuntime(input) {
    return Effect.gen(function* () {
      const { path: executablePath } = yield* validateExactToolPath(
        toolDiscovery,
        "antigravity",
        input.configuredExecutablePath,
      );
      const nextRuntimeId = runtimeId();
      const runtime = yield* createRuntimeSummary({
        kind: "antigravity",
        runtimeId: nextRuntimeId,
        runtimeRoute: { type: "stdio", identity: nextRuntimeId },
        descriptor: input.descriptor,
        startedAt: now(),
      });
      const prepared = yield* prepareLiveSessionAdapter(runtime, executablePath).pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "antigravityRuntime.prepareLiveSessionAdapter", {
            runtimeId: nextRuntimeId,
          }),
        ),
      );
      let acp: AntigravityAcpProcess | null = null;
      let stopping = false;
      let startupComplete = false;
      let connectionClosed = false;
      let reporting: Fiber.Fiber<void, never> | null = null;
      const liveSession = createLiveSessionAttachment({
        runtimeId: nextRuntimeId,
        runtimeLabel: "Antigravity",
        operationPrefix: "antigravityRuntime",
        lifecycle: liveSessionLifecycle,
        isClosed: () => stopping || connectionClosed || acp?.isClosed() === true,
        closeDescription: () =>
          acp?.closeDescription() ?? (connectionClosed ? CONNECTION_CLOSED : null),
      });
      liveSession.adopt(prepared);
      const cleanup: Effect.Effect<void, HostOperationErrorAggregate> = createRuntimeCleanup({
        runtimeId: nextRuntimeId,
        operation: "antigravityRuntime.close",
        releaseLiveState: liveSession.release,
        stopProcess: Effect.suspend(() =>
          acp ? stopAntigravityAcp(acp, `Antigravity runtime ${nextRuntimeId}`) : Effect.void,
        ),
        onStart: () => {
          stopping = true;
        },
      });
      // The host owns the prepared adapter and the process until startup returns.
      input.ownCleanup(cleanup);
      const started = yield* Effect.try({
        try: () =>
          spawnAntigravityAcp({
            executablePath,
            // Each session gets its workspace MCP binding in its own request.
            env: withoutOpenDucktorMcpEnvironment(readEnv()),
            cwd: launchDirectory,
            handlers: prepared.acp.handlers,
          }),
        catch: (cause) =>
          toHostOperationError(cause, "antigravityRuntime.spawn", {
            executablePath,
            launchDirectory,
          }),
      });
      acp = started;
      // The child can exit, or the SDK can close the connection while the child still runs.
      const reportUnexpectedEnd = (description: string) => {
        const unexpected = startupComplete && !stopping;
        if (!unexpected) return;
        stopping = true;
        const stderr = started.stderrTail();
        input.onRuntimeExit(
          `Antigravity ${description}.${stderr ? ` Output: ${stderr}` : ""} Restart the runtime to continue.`,
        );
        reporting = Effect.runFork(
          Effect.gen(function* () {
            const result = yield* Effect.result(cleanup);
            if (result._tag === "Failure") {
              yield* Effect.sync(() => input.onRuntimeCleanupFailed(result.failure.message));
            }
          }),
        );
      };
      started.child.once("close", () =>
        reportUnexpectedEnd(started.closeDescription() ?? "process exited"),
      );
      void started.connection.closed.then(() => {
        connectionClosed = true;
        reportUnexpectedEnd(CONNECTION_CLOSED);
      });
      yield* verifyAntigravityAcp(started, executablePath, clientVersion).pipe(
        Effect.mapError((cause) =>
          cause instanceof RuntimeExecutableIncompatibleError
            ? new HostValidationError({
                field: "agentRuntimes.antigravity.executablePath",
                message: cause.message,
                cause,
              })
            : cause,
        ),
      );
      prepared.acp.attachConnection(started.connection);
      yield* liveSession.attach;
      startupComplete = true;
      return {
        runtime,
        configuredExecutablePath: input.configuredExecutablePath,
        effectiveExecutablePath: executablePath,
        stop: () =>
          cleanup.pipe(
            Effect.ensuring(
              Effect.suspend(() => (reporting ? Fiber.join(reporting) : Effect.void)),
            ),
            Effect.mapError((cause) => toHostOperationError(cause, "antigravityRuntime.stop")),
          ),
      };
    });
  },
});
