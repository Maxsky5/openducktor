import type { WorkspaceSettingsError } from "../../application/workspaces/workspace-settings-service";
import type { NotificationService } from "../../application/notifications/notification-service";
import { Effect } from "effect";
import type { GeneratedImageWorkers } from "../../adapters/attachments/generated-image-worker-client";
import type { McpHostBridgeServer } from "../../adapters/mcp/mcp-host-bridge-server";
import type { TaskAssetStagingService } from "../../application/task-assets/task-asset-staging-service";
import type {
  TaskSyncLoopHandle,
  TaskSyncService,
} from "../../application/tasks/sync/task-sync-service";
import type { TerminalService } from "../../application/terminals/terminal-service";
import { HostOperationError, type HostOperationErrorAggregate } from "../../effect/host-errors";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { AzureDevOpsConnectionPort } from "../../ports/azure-devops-connection-port";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import {
  createStopMcpHostBridgeStep,
  createStopRuntimesStep,
  createStopTerminalsStep,
  type HostLifecycleLogger,
  type HostShutdownStep,
  runShutdownSteps,
  writeHostLifecycleLog,
} from "../host-lifecycle";

export type NodeHostRouterLifecycle = {
  initialize: () => Effect.Effect<
    void,
    HostOperationErrorAggregate | TaskStoreError | WorkspaceSettingsError
  >;
  dispose: () => Effect.Effect<void, HostOperationErrorAggregate>;
};

export const createNodeHostRouterLifecycle = ({
  assets,
  shutdownWorkspaceFiles,
  initializeAdmission,
  shutdownWorkspaceImports,
  shutdownWorkspaceSessionPersistence,
  unsubscribeImportCatalogs,
  notifications,
  azureDevOpsConnection,
  workspaceProviderSetup,
  imageWorkers,
  lifecycleLogger,
  mcpHostBridge,
  runtimeRegistry,
  initializeRuntimes,
  startupSweep,
  taskAssetStagingService,
  taskSyncService,
  terminalService,
}: {
  shutdownWorkspaceFiles: () => Effect.Effect<void>;
  initializeAdmission: () => Effect.Effect<void, WorkspaceSettingsError>;
  shutdownWorkspaceImports: () => Effect.Effect<void, HostOperationErrorAggregate>;
  shutdownWorkspaceSessionPersistence: () => Effect.Effect<void>;
  unsubscribeImportCatalogs: (() => void) | undefined;
  notifications: Pick<NotificationService, "initialize" | "dispose">;
  assets: { taskStoreConnectionShutdownStep: HostShutdownStep };
  azureDevOpsConnection?: Pick<AzureDevOpsConnectionPort, "shutdown"> | undefined;
  workspaceProviderSetup: {
    shutdown(): Effect.Effect<void, import("../../effect/host-errors").HostError>;
  };
  imageWorkers: Pick<GeneratedImageWorkers, "shutdown">;
  lifecycleLogger: HostLifecycleLogger;
  mcpHostBridge: McpHostBridgeServer | null | undefined;
  runtimeRegistry: RuntimeRegistryPort;
  /** Starts enabled shared runtimes in the background. */
  initializeRuntimes: () => Effect.Effect<void>;
  startupSweep: () => Effect.Effect<void, TaskStoreError>;
  taskAssetStagingService: Pick<TaskAssetStagingService, "shutdownCleanup">;
  taskSyncService: Pick<TaskSyncService, "startPullRequestSyncLoop"> | null;
  terminalService: TerminalService;
}): NodeHostRouterLifecycle => {
  let pullRequestSyncLoop: TaskSyncLoopHandle | null = null;
  let taskAssetStagingSwept = false;
  let runtimesInitialized = false;
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
        yield* initializeAdmission();
        if (!taskAssetStagingSwept) {
          yield* startupSweep();
          taskAssetStagingSwept = true;
        }
        if (mcpHostBridge) {
          // The bridge has independent readiness. Its failure stays visible in the bridge check
          // and blocks only operations that need the bridge.
          const bridge = yield* Effect.result(mcpHostBridge.ensureExternalDiscoveryReady());
          if (bridge._tag === "Failure") {
            yield* writeHostLifecycleLog(
              lifecycleLogger,
              "error",
              `The OpenDucktor MCP host bridge did not start: ${bridge.failure.message}`,
            );
          }
        }
        if (!runtimesInitialized) {
          runtimesInitialized = true;
          yield* initializeRuntimes();
        }
        yield* notifications.initialize();
        if (taskSyncService && pullRequestSyncLoop === null) {
          pullRequestSyncLoop = yield* taskSyncService.startPullRequestSyncLoop();
        }
      }),
    dispose: () =>
      Effect.gen(function* () {
        unsubscribeImportCatalogs?.();
        const loggingFailures: HostOperationError[] = [];
        const startLogResult = yield* Effect.result(
          writeHostLifecycleLog(lifecycleLogger, "info", "Shutting down OpenDucktor host services"),
        );
        if (startLogResult._tag === "Failure") {
          loggingFailures.push(startLogResult.failure);
        }
        const shutdownResult = yield* Effect.result(
          runShutdownSteps(
            [
              { label: "workspace file reads", run: shutdownWorkspaceFiles },
              { label: "notifications", run: notifications.dispose },
              { label: "workspace session imports", run: shutdownWorkspaceImports },
              { label: "workspace session renames", run: shutdownWorkspaceSessionPersistence },
              { label: "pull request sync loop", run: stopPullRequestSyncLoop },
              ...(azureDevOpsConnection
                ? [{ label: "Azure DevOps sign-in", run: () => azureDevOpsConnection.shutdown() }]
                : []),
              { label: "Workspace provider setup", run: () => workspaceProviderSetup.shutdown() },
              { label: "image workers", run: () => imageWorkers.shutdown },
              createStopTerminalsStep(terminalService),
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
        if (shutdownResult._tag === "Success") {
          const completeLogResult = yield* Effect.result(
            writeHostLifecycleLog(lifecycleLogger, "info", "OpenDucktor host services stopped"),
          );
          if (completeLogResult._tag === "Failure") {
            loggingFailures.push(completeLogResult.failure);
          }
        }
        if (shutdownResult._tag === "Failure" && loggingFailures.length > 0) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "host.dispose",
              message: `${shutdownResult.failure.message}\nLifecycle logging: ${loggingFailures
                .map((failure) => failure.message)
                .join("\n")}`,
              cause: shutdownResult.failure,
              details: {
                shutdownFailure: shutdownResult.failure,
                loggingFailures,
              },
            }),
          );
        }
        if (shutdownResult._tag === "Failure") {
          return yield* Effect.fail(shutdownResult.failure);
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
