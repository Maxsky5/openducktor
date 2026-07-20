import type { TaskCard } from "@openducktor/contracts";
import { Effect, type Scope } from "effect";
import { HostDependencyError, type HostOperationError } from "../../../effect/host-errors";
import type { GitPort } from "../../../ports/git-port";
import type { TaskStoreError, TaskStorePort } from "../../../ports/task-repository-ports";
import type { TaskSessionBootstrapCoordinator } from "../worktrees/task-session-bootstrap-coordinator";

type TaskClosureStore = Pick<TaskStorePort, "transitionTask">;

export const completeTaskClosure = <CleanupError>({
  cleanup,
  gitPort,
  operation,
  repoPath,
  taskId,
  taskSessionBootstrapCoordinator,
  taskStore,
}: {
  cleanup: Effect.Effect<void, CleanupError, Scope.Scope>;
  gitPort: Pick<GitPort, "canonicalizePath"> | undefined;
  operation: string;
  repoPath: string;
  taskId: string;
  taskSessionBootstrapCoordinator: TaskSessionBootstrapCoordinator | undefined;
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
      if (!taskSessionBootstrapCoordinator) {
        return yield* Effect.fail(
          new HostDependencyError({
            dependency: "taskSessionBootstrapCoordinator",
            operation,
            message: `Task session bootstrap coordinator is required to ${operation}.`,
          }),
        );
      }
      const canonicalRepoPath = yield* gitPort.canonicalizePath(repoPath);
      yield* taskSessionBootstrapCoordinator.acquireLifecycle(
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
