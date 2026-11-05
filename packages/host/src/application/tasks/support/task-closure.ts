import { Effect, type Scope } from "effect";
import { HostDependencyError, type HostOperationError } from "../../../effect/host-errors";
import type { GitPort } from "../../../ports/git-port";
import type {
  DecideTaskTransition,
  TaskRecord,
  TaskStoreError,
  TaskStorePort,
} from "../../../ports/task-repository-ports";
import type { TaskSessionLifecycleCoordinator } from "../worktrees/task-session-lifecycle-coordinator";

type TaskClosureStore = Pick<TaskStorePort, "transitionTask">;

/** Runs the cleanup of a closure under the task lifecycle lock, then commits the decided state. */
export const completeTaskClosure = <CleanupError, DecideError>({
  cleanup,
  decide,
  gitPort,
  operation,
  repoPath,
  taskId,
  workspaceId,
  taskSessionLifecycleCoordinator,
  taskStore,
}: {
  cleanup: Effect.Effect<void, CleanupError, Scope.Scope>;
  decide: DecideTaskTransition<DecideError>;
  gitPort: Pick<GitPort, "canonicalizePath"> | undefined;
  operation: string;
  repoPath: string;
  taskId: string;
  workspaceId: string;
  taskSessionLifecycleCoordinator: TaskSessionLifecycleCoordinator | undefined;
  taskStore: TaskClosureStore;
}): Effect.Effect<
  TaskRecord,
  CleanupError | DecideError | HostDependencyError | HostOperationError | TaskStoreError
> =>
  Effect.scoped(
    Effect.gen(function* () {
      if (!gitPort) {
        return yield* Effect.fail(
          new HostDependencyError({
            dependency: "gitPort",
            operation,
            message: `Git port is required to ${operation}.`,
          }),
        );
      }
      if (!taskSessionLifecycleCoordinator) {
        return yield* Effect.fail(
          new HostDependencyError({
            dependency: "taskSessionLifecycleCoordinator",
            operation,
            message: `Task session lifecycle coordinator is required to ${operation}.`,
          }),
        );
      }
      const canonicalRepoPath = yield* gitPort.canonicalizePath(repoPath);
      yield* taskSessionLifecycleCoordinator.acquireLifecycle(
        canonicalRepoPath,
        [taskId],
        operation,
      );
      yield* cleanup;
      return yield* Effect.suspend(() =>
        taskStore.transitionTask({ repoPath, taskId, workspaceId, decide }),
      );
    }),
  );
