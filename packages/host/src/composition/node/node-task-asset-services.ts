import { Effect } from "effect";
import { rm } from "node:fs/promises";
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
import type { TaskAssetError } from "../../effect/task-asset-error";
import { resolveOpenDucktorBaseDir } from "../../config/openducktor-config-dir";
import {
  sqliteTaskStoreDirectoryPath,
  TASK_STORE_DATABASE_FILENAME,
} from "../../infrastructure/sqlite/sqlite-task-store-path";
import {
  HostOperationError,
  type HostOperationErrorAggregate,
  type HostValidationErrorAggregate,
} from "../../effect/host-errors";
import type { TaskStoreError, TaskStorePort } from "../../ports/task-repository-ports";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { WorkspaceStoragePort } from "../../ports/workspace-storage-port";
import type { HostShutdownStep } from "../host-lifecycle";
import {
  createAssertPermanentRemovalSupported,
  createRemoveWorkspaceTaskStore,
} from "./remove-workspace-task-store";

export type NodeTaskAssetServices = {
  workspaceSessionStore: WorkspaceSessionStorePort;
  startupSweep: () => Effect.Effect<void, TaskStoreError>;
  taskAssetReadService: TaskAssetReadService;
  taskAssetStagingService: TaskAssetStagingService;
  taskStoreConnectionShutdownStep: HostShutdownStep;
  taskAssetStagingShutdownStep: HostShutdownStep;
  taskStore: TaskStorePort;
  removeWorkspaceTaskAssets: (workspaceId: string) => Effect.Effect<void, TaskAssetError>;
  removeWorkspaceTaskStore: (
    workspaceId: string,
  ) => Effect.Effect<void, HostOperationErrorAggregate>;
  assertPermanentRemovalSupported: (
    workspaceId: string,
  ) => Effect.Effect<void, HostOperationErrorAggregate>;
  workspaceTaskStoreExists: WorkspaceStoragePort["workspaceTaskStoreExists"];
};

export const createNodeTaskAssetServices = ({
  assertWorkspaceAdmitted,
  configuredTaskStore,
  isWorkspaceRemovalPending,
  onBackgroundFailure,
  processEnv,
  settingsConfig,
  withAdministrativeAccess,
  workspaceSettingsService,
}: {
  assertWorkspaceAdmitted: (input: {
    operation: string;
    repoPath: string;
    workspaceId: string;
  }) => Effect.Effect<void, HostOperationErrorAggregate | HostValidationErrorAggregate>;
  configuredTaskStore?: TaskStorePort | undefined;
  isWorkspaceRemovalPending: (workspaceId: string) => boolean;
  onBackgroundFailure: (failure: HostOperationErrorAggregate) => Effect.Effect<void, never>;
  processEnv: NodeJS.ProcessEnv;
  settingsConfig: SettingsConfigPort;
  withAdministrativeAccess: <A, E, R>(
    workspaceIds: readonly string[],
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  workspaceSettingsService: WorkspaceSettingsService;
}): NodeTaskAssetServices => {
  const resolveWorkspaceIdForRepoPath = (repoPath: string) =>
    workspaceSettingsService
      .getRepoConfigByRepoPath(repoPath)
      .pipe(Effect.map((repoConfig) => repoConfig.workspaceId));
  const configDir = resolveOpenDucktorBaseDir(processEnv);
  const filePort = createNodeTaskAssetFilePort({ configDir });
  const taskAssetStagingService = createTaskAssetStagingService(filePort);
  const contextManager = createSqliteTaskRepositoryContextManager({
    assertWorkspaceAdmitted,
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
    isWorkspaceRemovalPending,
    registry,
    resolveRepoPath: (workspaceId) =>
      workspaceSettingsService
        .getRepoConfig(workspaceId)
        .pipe(Effect.map((repoConfig) => repoConfig.repoPath)),
    taskStore: inner,
    withAdministrativeAccess,
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
    removeWorkspaceTaskAssets: (workspaceId) => filePort.removeWorkspaceData({ workspaceId }),
    workspaceTaskStoreExists: (workspaceId) =>
      settingsConfig.pathExists(
        settingsConfig.join(
          sqliteTaskStoreDirectoryPath(configDir, workspaceId),
          TASK_STORE_DATABASE_FILENAME,
        ),
      ),
    removeWorkspaceTaskStore: createRemoveWorkspaceTaskStore({
      closeWorkspace: (workspaceId) => contextManager.closeWorkspace(workspaceId),
      configuredTaskStore,
      removeDirectory: (workspaceId) =>
        Effect.tryPromise({
          try: () =>
            rm(sqliteTaskStoreDirectoryPath(configDir, workspaceId), {
              force: true,
              recursive: true,
            }),
          catch: (cause) =>
            new HostOperationError({
              operation: "workspace.removeTaskStoreDirectory",
              message: `Failed to remove the task store directory for workspace ${workspaceId}.`,
              cause,
            }),
        }),
    }),
    assertPermanentRemovalSupported: createAssertPermanentRemovalSupported({ configuredTaskStore }),
  };
};
