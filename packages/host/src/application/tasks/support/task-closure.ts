import { Effect, type Scope } from "effect";
import type { TaskWorkflowResolver } from "../../../ports/task-workflow-port";
import type { TaskPolicyError } from "../../../domain/task";
import { HostDependencyError, type HostOperationError } from "../../../effect/host-errors";
import type { GitPort } from "../../../ports/git-port";
import type {
  TaskRecord,
  TaskStoreError,
  TaskStorePort,
} from "../../../ports/task-repository-ports";
import type { TaskSessionLifecycleCoordinator } from "../worktrees/task-session-lifecycle-coordinator";
import { decideEffectTransition, type HostEffect } from "./task-workflow-events";

type TaskClosureStore = Pick<TaskStorePort, "transitionTask">;

export const completeTaskClosure = <CleanupError>({
  cleanup,
  taskWorkflows,
  effect,
  gitPort,
  operation,
  repoPath,
  taskId,
  workspaceId,
  taskSessionLifecycleCoordinator,
  taskStore,
}: {
  cleanup: Effect.Effect<void, CleanupError, Scope.Scope>;
  taskWorkflows: TaskWorkflowResolver;
  effect: HostEffect;
  gitPort: Pick<GitPort, "canonicalizePath"> | undefined;
  operation: string;
  repoPath: string;
  taskId: string;
  workspaceId: string;
  taskSessionLifecycleCoordinator: TaskSessionLifecycleCoordinator | undefined;
  taskStore: TaskClosureStore;
}): Effect.Effect<
  TaskRecord,
  CleanupError | HostDependencyError | HostOperationError | TaskStoreError | TaskPolicyError
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
        taskStore.transitionTask({
          repoPath,
          taskId,
          workspaceId,
          decide: (current) =>
            decideEffectTransition(taskWorkflows.forTask(current), effect, current),
        }),
      );
    }),
  );
