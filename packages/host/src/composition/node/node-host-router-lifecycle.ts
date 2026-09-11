import { Effect } from "effect";
import type { GeneratedImageWorkers } from "../../adapters/attachments/generated-image-worker-client";
import type { McpHostBridgeServer } from "../../adapters/mcp/mcp-host-bridge-server";
import type { TaskAssetStagingService } from "../../application/task-assets/task-asset-staging-service";
import type {
  TaskSyncLoopHandle,
  TaskSyncService,
} from "../../application/tasks/sync/task-sync-service";
import type { TerminalService } from "../../application/terminals/terminal-service";
import type { DisposableDevServerService } from "../../application/dev-servers/dev-server-service-types";
import { HostOperationError, type HostOperationErrorAggregate } from "../../effect/host-errors";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import {
  createStopDevServersStep,
  createStopMcpHostBridgeStep,
  createStopRuntimesStep,
  createStopTerminalsStep,
  type HostLifecycleLogger,
  type HostShutdownStep,
  runShutdownSteps,
  writeHostLifecycleLog,
} from "../host-lifecycle";

export type NodeHostRouterLifecycle = {
  initialize: () => Effect.Effect<void, HostOperationErrorAggregate | TaskStoreError>;
  dispose: () => Effect.Effect<void, HostOperationErrorAggregate>;
};

export const createNodeHostRouterLifecycle = ({
  assets,
  devServerService,
  imageWorkers,
  lifecycleLogger,
  mcpHostBridge,
  runtimeRegistry,
  startupSweep,
  taskAssetStagingService,
  taskSyncService,
  terminalService,
}: {
  assets: { taskStoreConnectionShutdownStep: HostShutdownStep };
  devServerService: DisposableDevServerService;
  imageWorkers: Pick<GeneratedImageWorkers, "shutdown">;
  lifecycleLogger: HostLifecycleLogger;
  mcpHostBridge: McpHostBridgeServer | null | undefined;
  runtimeRegistry: RuntimeRegistryPort;
  startupSweep: () => Effect.Effect<void, TaskStoreError>;
  taskAssetStagingService: Pick<TaskAssetStagingService, "shutdownCleanup">;
  taskSyncService: Pick<TaskSyncService, "startPullRequestSyncLoop"> | null;
  terminalService: TerminalService;
}): NodeHostRouterLifecycle => {
  let pullRequestSyncLoop: TaskSyncLoopHandle | null = null;
  let taskAssetStagingSwept = false;
  const stopPullRequestSyncLoop = () =>
    Effect.gen(function* () {
      if (!pullRequestSyncLoop) {
        yield* writeHostLifecycleLog(
          lifecycleLogger,
          "info",
          "No pull request sync loop is running",
        );
        return;
      }
      yield* pullRequestSyncLoop.stop();
      pullRequestSyncLoop = null;
      yield* writeHostLifecycleLog(lifecycleLogger, "info", "Pull request sync loop stopped");
    });

  return {
    initialize: () =>
      Effect.gen(function* () {
        if (!taskAssetStagingSwept) {
          yield* startupSweep();
          taskAssetStagingSwept = true;
        }
        if (mcpHostBridge) {
          yield* mcpHostBridge.ensureExternalDiscoveryReady().pipe(
            Effect.mapError(
              (cause) =>
                new HostOperationError({
                  operation: "mcp-host-bridge.ensure-external-discovery",
                  message: cause.message,
                  cause,
                }),
            ),
          );
        }
        if (taskSyncService && pullRequestSyncLoop === null) {
          pullRequestSyncLoop = yield* taskSyncService.startPullRequestSyncLoop();
        }
      }),
    dispose: () =>
      Effect.gen(function* () {
        const loggingFailures: HostOperationError[] = [];
        const startLogResult = yield* Effect.either(
          writeHostLifecycleLog(lifecycleLogger, "info", "Shutting down OpenDucktor host services"),
        );
        if (startLogResult._tag === "Left") {
          loggingFailures.push(startLogResult.left);
        }
        const shutdownResult = yield* Effect.either(
          runShutdownSteps(
            [
              { label: "pull request sync loop", run: stopPullRequestSyncLoop },
              { label: "image workers", run: () => imageWorkers.shutdown },
              createStopTerminalsStep(terminalService),
              createStopDevServersStep(devServerService, lifecycleLogger),
              createStopRuntimesStep(runtimeRegistry, lifecycleLogger),
              createStopMcpHostBridgeStep(mcpHostBridge ?? undefined, lifecycleLogger),
              {
                label: "task asset staging",
                run: () =>
                  taskAssetStagingService.shutdownCleanup().pipe(
                    Effect.mapError(
                      (cause) =>
                        new HostOperationError({
                          operation: "host.dispose.task_assets",
                          message: cause.message,
                          cause,
                        }),
                    ),
                  ),
              },
              assets.taskStoreConnectionShutdownStep,
            ],
            lifecycleLogger,
          ),
        );
        if (shutdownResult._tag === "Right") {
          const completeLogResult = yield* Effect.either(
            writeHostLifecycleLog(lifecycleLogger, "info", "OpenDucktor host services stopped"),
          );
          if (completeLogResult._tag === "Left") {
            loggingFailures.push(completeLogResult.left);
          }
        }
        if (shutdownResult._tag === "Left" && loggingFailures.length > 0) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "host.dispose",
              message: `${shutdownResult.left.message}\nLifecycle logging: ${loggingFailures
                .map((failure) => failure.message)
                .join("\n")}`,
              cause: shutdownResult.left,
              details: {
                shutdownFailure: shutdownResult.left,
                loggingFailures,
              },
            }),
          );
        }
        if (shutdownResult._tag === "Left") {
          return yield* Effect.fail(shutdownResult.left);
        }
        const [loggingFailure] = loggingFailures;
        if (loggingFailures.length === 1 && loggingFailure) {
          return yield* Effect.fail(loggingFailure);
        }
        if (loggingFailures.length > 1) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "host.dispose",
              message: loggingFailures.map((failure) => failure.message).join("\n"),
              cause: loggingFailures[0],
              details: { loggingFailures },
            }),
          );
        }
      }),
  };
};
