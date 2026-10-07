import { Effect, TxReentrantLock } from "effect";
import { validateParentRelationshipsForCreate } from "../../domain/task";
import { HostValidationError } from "../../effect/host-errors";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import { createTaskAssetAwareCreate } from "./task-asset-aware-create";
import { createTaskAssetAwareDelete } from "./task-asset-aware-delete";
import type { TaskAssetAwareMutationDependencies } from "./task-asset-aware-task-store-support";
import { createTaskAssetAwareUpdate } from "./task-asset-aware-update";

type CreateTaskAssetAwareTaskStoreInput = TaskAssetAwareMutationDependencies;

/**
 * Waits for the lock while the caller can still cancel. When the lock is held, the mutation runs
 * to its commit or its file restoration before the lock is released. `TxReentrantLock.withReadLock`
 * and `withWriteLock` do the opposite: they wait uninterruptibly and let the mutation stop midway.
 */
const withMutationLock = <A, E, R>(
  acquire: Effect.Effect<number>,
  release: Effect.Effect<number>,
  mutation: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.uninterruptibleMask((restore) =>
    // The release also covers an interruption after the lock commits and before the mutation
    // starts. It changes nothing when this fiber holds no lock.
    restore(acquire).pipe(Effect.andThen(mutation), Effect.ensuring(release)),
  );

export const createTaskAssetAwareTaskStore = (
  dependencies: CreateTaskAssetAwareTaskStoreInput,
): TaskStorePort => {
  // Create and update share the lock. Delete holds it alone.
  const mutationLock = Effect.runSync(TxReentrantLock.make());
  const shared = <A, E, R>(mutation: Effect.Effect<A, E, R>) =>
    withMutationLock(
      TxReentrantLock.acquireRead(mutationLock),
      TxReentrantLock.releaseRead(mutationLock),
      mutation,
    );
  const exclusive = <A, E, R>(mutation: Effect.Effect<A, E, R>) =>
    withMutationLock(
      TxReentrantLock.acquireWrite(mutationLock),
      TxReentrantLock.releaseWrite(mutationLock),
      mutation,
    );
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
    createTask: (input) => shared(createWithParentValidation(input)),
    updateTask: (input) => shared(updateTask(input)),
    deleteTask: (input) => exclusive(deleteTask(input)),
  };
};
