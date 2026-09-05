import type { TaskCard } from "@openducktor/contracts";
import { Effect, type Scope } from "effect";
import { HostDependencyError, type HostOperationError } from "../../../effect/host-errors";
import type { GitPort } from "../../../ports/git-port";
import type { TaskStoreError, TaskStorePort } from "../../../ports/task-repository-ports";
import type { TaskSessionLifecycleCoordinator } from "../worktrees/task-session-lifecycle-coordinator";

type TaskClosureStore = Pick<TaskStorePort, "transitionTask">;

export const completeTaskClosure = <CleanupError>({
  cleanup,
  gitPort,
  operation,
  repoPath,
  taskId,
  taskSessionLifecycleCoordinator,
  taskStore,
}: {
  cleanup: Effect.Effect<void, CleanupError, Scope.Scope>;
  gitPort: Pick<GitPort, "canonicalizePath"> | undefined;
  operation: string;
  repoPath: string;
  taskId: string;
  taskSessionLifecycleCoordinator: TaskSessionLifecycleCoordinator | undefined;
  taskStore: TaskClosureStore;
}): Effect.Effect<
  TaskCard,
  CleanupError | HostDependencyError | HostOperationError | TaskStoreError
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
        taskStore.transitionTask({ repoPath, taskId, status: "closed" }),
      );
    }),
  );
