import { Effect } from "effect";
import { rm } from "node:fs/promises";
import path from "node:path";
import { createNodeTaskAssetFilePort } from "../../adapters/node/filesystem-task-asset-file-port";
import { createSqliteTaskAssetRegistry } from "../../adapters/sqlite/sqlite-task-asset-registry";
import { createSqliteTaskRepository } from "../../adapters/sqlite/sqlite-task-repository";
import { createSqliteWorkspaceSessionStore } from "../../adapters/sqlite/sqlite-workspace-session-store";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import { createSqliteTaskRepositoryContextManager } from "../../adapters/sqlite/sqlite-task-repository-context";
import { createTaskAssetAwareTaskStore } from "../../application/task-assets/task-asset-aware-task-store";
import {
  createTaskAssetReadService,
  type TaskAssetReadService,
} from "../../application/task-assets/task-asset-read-service";
import { createTaskAssetRecoveryService } from "../../application/task-assets/task-asset-recovery-service";
import {
  createTaskAssetStagingService,
  type TaskAssetStagingService,
} from "../../application/task-assets/task-asset-staging-service";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-model";
import type { OpenDucktorConfigDir } from "../../config/openducktor-config-dir";
import type { TaskAssetError } from "../../effect/task-asset-error";
import { HostOperationError, type HostOperationErrorAggregate } from "../../effect/host-errors";
import type { TaskStoreError, TaskStorePort } from "../../ports/task-repository-ports";
import type { HostShutdownStep } from "../host-lifecycle";

export type NodeTaskAssetServices = {
  workspaceSessionStore: WorkspaceSessionStorePort;
  startupSweep: () => Effect.Effect<void, TaskStoreError>;
  taskAssetReadService: TaskAssetReadService;
  taskAssetStagingService: TaskAssetStagingService;
  taskStoreConnectionShutdownStep: HostShutdownStep;
  taskAssetStagingShutdownStep: HostShutdownStep;
  taskStore: TaskStorePort;
  removeWorkspaceData: (
    workspaceId: string,
  ) => Effect.Effect<void, TaskAssetError | HostOperationErrorAggregate>;
};

export const createNodeTaskAssetServices = ({
  configDir,
  configuredTaskStore,
  onBackgroundFailure,
  processEnv,
  workspaceSettingsService,
}: {
  configDir: OpenDucktorConfigDir;
  configuredTaskStore?: TaskStorePort | undefined;
  onBackgroundFailure: (failure: HostOperationErrorAggregate) => Effect.Effect<void, never>;
  processEnv: NodeJS.ProcessEnv;
  workspaceSettingsService: WorkspaceSettingsService;
}): NodeTaskAssetServices => {
  const resolveWorkspaceIdForRepoPath = (repoPath: string) =>
    workspaceSettingsService
      .getRepoConfigByRepoPath(repoPath)
      .pipe(Effect.map((repoConfig) => repoConfig.workspaceId));
  const filePort = createNodeTaskAssetFilePort({
    configDir: configDir.root,
    configDirScope: configDir.scope,
    reportProbeFailure: ({ cause, owner }) =>
      Effect.runPromise(
        onBackgroundFailure(
          new HostOperationError({
            operation: "taskAssets.probeOwner",
            message: `Could not verify task asset owner '${owner.instanceId}' process ${owner.processId}. OpenDucktor kept its staged files.`,
            cause,
            details: {
              instanceId: owner.instanceId,
              processId: owner.processId,
            },
          }),
        ),
      ),
  });
  const taskAssetStagingService = createTaskAssetStagingService(filePort);
  const contextManager = createSqliteTaskRepositoryContextManager({
    configDir: configDir.root,
    onBackgroundFailure,
    processEnv,
    resolveWorkspaceIdForRepoPath,
  });
  const registry = createSqliteTaskAssetRegistry({
    contextProvider: contextManager.withDatabase,
  });
  const inner =
    configuredTaskStore ??
    createSqliteTaskRepository({
      contextProvider: contextManager.withDatabase,
    });
  const taskAssetReadService = createTaskAssetReadService({
    filePort,
    registry,
    resolveRepoPath: (workspaceId) =>
      workspaceSettingsService
        .getRepoConfig(workspaceId)
        .pipe(Effect.map((repoConfig) => repoConfig.repoPath)),
  });
  const taskAssetRecoveryService = createTaskAssetRecoveryService({
    filePort,
    registry,
    resolveRepoPath: (workspaceId) =>
      workspaceSettingsService
        .getRepoConfig(workspaceId)
        .pipe(Effect.map((repoConfig) => repoConfig.repoPath)),
    taskStore: inner,
  });

  return {
    workspaceSessionStore: createSqliteWorkspaceSessionStore(contextManager.withDatabase),
    startupSweep: () =>
      taskAssetRecoveryService
        .startupSweep()
        .pipe(Effect.zipRight(taskAssetStagingService.startupSweep()), Effect.asVoid),
    taskAssetReadService,
    taskAssetStagingService,
    taskAssetStagingShutdownStep: {
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
    taskStoreConnectionShutdownStep: {
      label: "SQLite task store connections",
      run: contextManager.dispose,
    },
    taskStore: createTaskAssetAwareTaskStore({
      inner,
      registry,
      filePort,
      staging: taskAssetStagingService,
      persistence: configuredTaskStore ? null : registry,
      resolveWorkspaceIdForRepoPath,
    }),
    removeWorkspaceData: (workspaceId) =>
      Effect.gen(function* () {
        yield* filePort.removeWorkspaceData({ workspaceId });
        yield* contextManager.closeWorkspace(workspaceId);
        const taskStoreRoot = path.join(configDir.root, "task-stores");
        yield* Effect.tryPromise({
          try: () => rm(path.join(taskStoreRoot, workspaceId), { force: true, recursive: true }),
          catch: (cause) =>
            new HostOperationError({
              operation: "workspace.removeTaskStoreDirectory",
              message: `Failed to remove the task store directory for workspace ${workspaceId}.`,
              cause,
            }),
        });
      }),
  };
};
