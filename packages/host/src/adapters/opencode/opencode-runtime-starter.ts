import { randomUUID } from "node:crypto";
import type { OpenCodeRuntimeConnection } from "@openducktor/adapters-opencode-sdk";
import { Clock, Effect } from "effect";
import { HostOperationError, toHostOperationError } from "../../effect/host-errors";
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
import {
  acquireOpenCodeStandalone,
  type OpenCodeStandaloneOptions,
} from "./opencode-standalone-process";
import { acquireOpenCodeWorkflowPlugin } from "./opencode-workflow-plugin-lease";

export type CreateOpenCodeRuntimeStarterInput = OpenCodeStandaloneOptions & {
  toolDiscovery: ToolDiscoveryPort;
  liveSessionLifecycle: RuntimeLiveSessionLifecyclePort;
  prepareLiveSessionAdapter: OpenCodeLiveSessionAdapterPreparer;
  launchDirectory: string;
  onConnectionReady: (connection: OpenCodeRuntimeConnection) => void;
  onConnectionClosed: (runtimeId: string) => void;
  now?: () => Date;
  runtimeId?: () => string;
};

/** Starts one owned V2 process for all workspaces. The orchestrator owns failed-start cleanup. */
export const createOpenCodeRuntimeStarter = (
  options: CreateOpenCodeRuntimeStarterInput,
): RuntimeStarterPort => ({
  startRuntime(input) {
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const { path: binary } = yield* validateExactToolPath(
          options.toolDiscovery,
          "opencode",
          input.configuredExecutablePath,
        );
        const runtimeId = (options.runtimeId ?? randomUUID)();
        const startedAtMs = yield* Clock.currentTimeMillis;
        const startupTimeoutMs = options.startupTimeoutMs ?? 30_000;
        const processEnv = withoutOpenDucktorMcpEnvironment(
          (options.readEnv ?? (() => process.env))(),
        );
        delete processEnv.OPENCODE_SERVER_PASSWORD;
        delete processEnv.OPENCODE_SERVER_USERNAME;
        const workflowPlugin = yield* acquireOpenCodeWorkflowPlugin({
          env: processEnv,
          ownCleanup: input.ownCleanup,
        });
        processEnv.OPENCODE_CONFIG_CONTENT = workflowPlugin.configContent;
        const owned = yield* acquireOpenCodeStandalone({
          ...options,
          executablePath: binary,
          workingDirectory: options.launchDirectory,
          runtimeId,
          readEnv: () => processEnv,
        });
        let startupCompleted = false;
        let stopRequested = false;
        let exitMessage: string | null = null;
        let lossBeforeStartup: string | null = null;
        const reportRuntimeExit = (message: string): void => {
          if (stopRequested || exitMessage !== null) return;
          if (!startupCompleted) {
            lossBeforeStartup ??= message;
            return;
          }
          exitMessage = message;
          input.onRuntimeExit(message);
        };
        const reportCleanupFailure = (message: string): void => {
          if (!stopRequested && exitMessage !== null) input.onRuntimeCleanupFailed(message);
        };
        const liveSession = createLiveSessionAttachment({
          runtimeId,
          runtimeLabel: "OpenCode",
          operationPrefix: "opencodeRuntime",
          lifecycle: options.liveSessionLifecycle,
          isClosed: owned.isClosed,
          closeDescription: owned.closeDescription,
        });
        const stop = createRuntimeCleanup({
          runtimeId,
          operation: "opencodeRuntime.stop",
          releaseLiveState: liveSession.release,
          stopProcess: owned.stop.pipe(
            Effect.andThen(workflowPlugin.release),
            Effect.tap(() => Effect.sync(() => options.onConnectionClosed(runtimeId))),
          ),
          onStart: () => {
            stopRequested = true;
          },
        });
        input.ownCleanup(stop);
        owned.onClose(() => {
          options.onConnectionClosed(runtimeId);
          reportRuntimeExit(owned.closeDescription() ?? "OpenCode V2 exited.");
          Effect.runFork(
            liveSession.release.pipe(
              Effect.catch((cause) => Effect.sync(() => reportCleanupFailure(cause.message))),
            ),
          );
        });
        return yield* restore(
          Effect.gen(function* () {
            const connection = yield* owned.waitReady;
            const runtime = yield* createRuntimeSummary({
              kind: "opencode",
              runtimeId,
              runtimeRoute: { type: "local_http", endpoint: connection.endpoint },
              descriptor: input.descriptor,
              startedAt: (options.now ?? (() => new Date()))(),
            });
            const elapsedMs = (yield* Clock.currentTimeMillis) - startedAtMs;
            yield* Effect.gen(function* () {
              yield* workflowPlugin.bind(connection);
              options.onConnectionReady(connection);
              const prepared = yield* options.prepareLiveSessionAdapter(
                runtime,
                {
                  onObservationLost: reportRuntimeExit,
                  onCleanupFailed: reportCleanupFailure,
                },
                connection,
              );
              liveSession.adopt(prepared);
              yield* liveSession.attach;
            }).pipe(
              Effect.mapError((cause) =>
                toHostOperationError(cause, "opencodeRuntime.startRuntime"),
              ),
              Effect.timeoutOrElse({
                duration: `${Math.max(0, startupTimeoutMs - elapsedMs)} millis`,
                orElse: () =>
                  Effect.fail(
                    new HostOperationError({
                      operation: "opencodeRuntime.startRuntime",
                      message:
                        "OpenCode V2 live-session startup timed out. Check the selected executable and restart OpenCode from Diagnostics.",
                    }),
                  ),
              }),
            );
            if (lossBeforeStartup !== null)
              return yield* new HostOperationError({
                operation: "opencodeRuntime.startRuntime",
                message: `OpenCode V2 lost live observation during startup: ${lossBeforeStartup}`,
              });
            startupCompleted = true;
            return {
              runtime,
              configuredExecutablePath: input.configuredExecutablePath,
              effectiveExecutablePath: binary,
              stop: () =>
                stop.pipe(
                  Effect.mapError((cause) => toHostOperationError(cause, "opencodeRuntime.stop")),
                ),
            };
          }),
        );
      }),
    );
  },
});
