import { Effect, STM, TReentrantLock } from "effect";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import { createTaskAssetAwareCreate } from "./task-asset-aware-create";
import { createTaskAssetAwareDelete } from "./task-asset-aware-delete";
import type { TaskAssetAwareMutationDependencies } from "./task-asset-aware-task-store-support";
import { createTaskAssetAwareUpdate } from "./task-asset-aware-update";

type CreateTaskAssetAwareTaskStoreInput = TaskAssetAwareMutationDependencies;

export const createTaskAssetAwareTaskStore = (
  dependencies: CreateTaskAssetAwareTaskStoreInput,
): TaskStorePort => {
  const mutationLock = Effect.runSync(STM.commit(TReentrantLock.make));
  const runMutation = TReentrantLock.withReadLock(mutationLock);
  const runDelete = TReentrantLock.withWriteLock(mutationLock);
  const createTask = createTaskAssetAwareCreate(dependencies);
  const updateTask = createTaskAssetAwareUpdate(dependencies);
  const deleteTask = createTaskAssetAwareDelete({
    assetPersistenceEnabled: dependencies.persistence !== null,
    filePort: dependencies.filePort,
    inner: dependencies.inner,
    registry: dependencies.registry,
    resolveWorkspaceIdForRepoPath: dependencies.resolveWorkspaceIdForRepoPath,
  });

  return {
    ...dependencies.inner,
    createTask: (input) => runMutation(createTask(input)),
    updateTask: (input) => runMutation(updateTask(input)),
    deleteTask: (input) => runDelete(deleteTask(input)),
  };
};
