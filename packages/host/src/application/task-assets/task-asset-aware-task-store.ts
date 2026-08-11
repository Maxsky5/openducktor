import { Effect, STM, TReentrantLock } from "effect";
import { validateParentRelationshipsForCreate } from "../../domain/task";
import { HostValidationError } from "../../effect/host-errors";
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
  const createWithParentValidation = (input: Parameters<TaskStorePort["createTask"]>[0]) =>
    Effect.gen(function* () {
      if (input.task.parentId?.trim()) {
        const tasks = yield* dependencies.inner.listTasks({ repoPath: input.repoPath });
        yield* Effect.try({
          try: () => validateParentRelationshipsForCreate(tasks, input.task),
          catch: (cause) =>
            new HostValidationError({
              field: "parentId",
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
      }
      return yield* createTask(input);
    });

  return {
    ...dependencies.inner,
    createTask: (input) => runMutation(createWithParentValidation(input)),
    updateTask: (input) => runMutation(updateTask(input)),
    deleteTask: (input) => runDelete(deleteTask(input)),
  };
};
