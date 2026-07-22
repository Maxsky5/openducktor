import { Effect } from "effect";
import { createNodeTaskAssetFilePort } from "../../adapters/node/filesystem-task-asset-file-port";
import { createSqliteTaskAssetRegistry } from "../../adapters/sqlite/sqlite-task-asset-registry";
import { createSqliteTaskRepository } from "../../adapters/sqlite/sqlite-task-repository";
import { createTaskAssetAwareTaskStore } from "../../application/task-assets/task-asset-aware-task-store";
import {
  createTaskAssetReadService,
  type TaskAssetReadService,
} from "../../application/task-assets/task-asset-read-service";
import {
  createTaskAssetStagingService,
  type TaskAssetStagingService,
} from "../../application/task-assets/task-asset-staging-service";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-model";
import { resolveOpenDucktorBaseDir } from "../../config/openducktor-config-dir";
import type { TaskStorePort } from "../../ports/task-repository-ports";

export type NodeTaskAssetServices = {
  taskAssetReadService: TaskAssetReadService;
  taskAssetStagingService: TaskAssetStagingService;
  taskStore: TaskStorePort;
};

export const createNodeTaskAssetServices = ({
  configuredTaskStore,
  processEnv,
  workspaceSettingsService,
}: {
  configuredTaskStore?: TaskStorePort;
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
  const registry = createSqliteTaskAssetRegistry({
    processEnv,
    resolveWorkspaceIdForRepoPath,
  });
  const taskAssetReadService = createTaskAssetReadService({
    filePort,
    registry,
    resolveRepoPath: (workspaceId) =>
      workspaceSettingsService
        .getRepoConfig(workspaceId)
        .pipe(Effect.map((repoConfig) => repoConfig.repoPath)),
  });

  if (configuredTaskStore) {
    return {
      taskAssetReadService,
      taskAssetStagingService,
      taskStore: configuredTaskStore,
    };
  }

  const inner = createSqliteTaskRepository({
    processEnv,
    resolveWorkspaceIdForRepoPath,
  });
  return {
    taskAssetReadService,
    taskAssetStagingService,
    taskStore: createTaskAssetAwareTaskStore({
      inner,
      registry,
      filePort,
      staging: taskAssetStagingService,
      resolveWorkspaceIdForRepoPath,
    }),
  };
};
