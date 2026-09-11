import { Effect } from "effect";
import { rm } from "node:fs/promises";
import path from "node:path";
import { createNodeTaskAssetFilePort } from "../../adapters/node/filesystem-task-asset-file-port";
import { createSqliteTaskAssetRegistry } from "../../adapters/sqlite/sqlite-task-asset-registry";
import { createSqliteTaskRepository } from "../../adapters/sqlite/sqlite-task-repository";
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
  HostOperationError,
  type HostOperationErrorAggregate,
  type HostValidationErrorAggregate,
} from "../../effect/host-errors";
import type { TaskStoreError, TaskStorePort } from "../../ports/task-repository-ports";
import type { HostShutdownStep } from "../host-lifecycle";

export type NodeTaskAssetServices = {
  startupSweep: () => Effect.Effect<void, TaskStoreError>;
  taskAssetReadService: TaskAssetReadService;
  taskAssetStagingService: TaskAssetStagingService;
  taskStoreConnectionShutdownStep: HostShutdownStep;
  taskStore: TaskStorePort;
  removeWorkspaceTaskAssets: (workspaceId: string) => Effect.Effect<void, TaskAssetError>;
  removeWorkspaceTaskStore: (
    workspaceId: string,
  ) => Effect.Effect<void, HostOperationErrorAggregate>;
};

export const createNodeTaskAssetServices = ({
  assertWorkspaceAdmitted,
  configuredTaskStore,
  isWorkspaceBlocked,
  onBackgroundFailure,
  processEnv,
  workspaceSettingsService,
}: {
  assertWorkspaceAdmitted?: (input: {
    operation: string;
    repoPath: string;
    workspaceId: string;
  }) => Effect.Effect<void, HostOperationErrorAggregate | HostValidationErrorAggregate>;
  configuredTaskStore?: TaskStorePort;
  isWorkspaceBlocked?: (workspaceId: string) => boolean;
  onBackgroundFailure: (failure: HostOperationErrorAggregate) => Effect.Effect<void, never>;
  processEnv: NodeJS.ProcessEnv;
  workspaceSettingsService: WorkspaceSettingsService;
}): NodeTaskAssetServices => {
  const resolveWorkspaceIdForRepoPath = (repoPath: string) =>
    workspaceSettingsService
      .getRepoConfigByRepoPath(repoPath)
      .pipe(Effect.map((repoConfig) => repoConfig.workspaceId));
  const filePort = createNodeTaskAssetFilePort({
    configDir: resolveOpenDucktorBaseDir(processEnv),
  });
  const taskAssetStagingService = createTaskAssetStagingService(filePort);
  const contextManagerInput: Parameters<typeof createSqliteTaskRepositoryContextManager>[0] = {
    onBackgroundFailure,
    processEnv,
    resolveWorkspaceIdForRepoPath,
  };
  if (assertWorkspaceAdmitted) {
    contextManagerInput.assertWorkspaceAdmitted = assertWorkspaceAdmitted;
  }
  const contextManager = createSqliteTaskRepositoryContextManager(contextManagerInput);
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
  const recoveryServiceInput: Parameters<typeof createTaskAssetRecoveryService>[0] = {
    filePort,
    registry,
    resolveRepoPath: (workspaceId) =>
      workspaceSettingsService
        .getRepoConfig(workspaceId)
        .pipe(Effect.map((repoConfig) => repoConfig.repoPath)),
    taskStore: inner,
  };
  if (isWorkspaceBlocked) {
    recoveryServiceInput.isWorkspaceBlocked = isWorkspaceBlocked;
  }
  const taskAssetRecoveryService = createTaskAssetRecoveryService(recoveryServiceInput);
  const taskStoreRoot = path.join(resolveOpenDucktorBaseDir(processEnv), "task-stores");

  return {
    startupSweep: () =>
      taskAssetRecoveryService
        .startupSweep()
        .pipe(Effect.zipRight(taskAssetStagingService.startupSweep()), Effect.asVoid),
    taskAssetReadService,
    taskAssetStagingService,
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
    removeWorkspaceTaskStore: (workspaceId) =>
      Effect.gen(function* () {
        yield* contextManager.closeWorkspace(workspaceId);
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
