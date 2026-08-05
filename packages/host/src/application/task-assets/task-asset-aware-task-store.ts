import type { TaskStorePort } from "../../ports/task-repository-ports";
import { createTaskAssetAwareCreate } from "./task-asset-aware-create";
import { createTaskAssetAwareDelete } from "./task-asset-aware-delete";
import type { TaskAssetAwareMutationDependencies } from "./task-asset-aware-task-store-support";
import { createTaskAssetAwareUpdate } from "./task-asset-aware-update";

type CreateTaskAssetAwareTaskStoreInput = TaskAssetAwareMutationDependencies;

export const createTaskAssetAwareTaskStore = (
  dependencies: CreateTaskAssetAwareTaskStoreInput,
): TaskStorePort => ({
  ...dependencies.inner,
  createTask: createTaskAssetAwareCreate(dependencies),
  updateTask: createTaskAssetAwareUpdate(dependencies),
  deleteTask: createTaskAssetAwareDelete({
    assetPersistenceEnabled: dependencies.persistence !== null,
    filePort: dependencies.filePort,
    inner: dependencies.inner,
    registry: dependencies.registry,
    resolveWorkspaceIdForRepoPath: dependencies.resolveWorkspaceIdForRepoPath,
  }),
});
