import { Effect } from "effect";
import { canonicalTargetBranch, checkoutBranch } from "../../../domain/task";
import { HostDependencyError, HostValidationError } from "../../../effect/host-errors";
import { requireMergedTaskCleanupDependencies } from "../support/required-task-dependencies";
import { validateTaskTransitionEffect } from "../support/task-validation-effects";
import { enrichTask, taskListWithCurrent } from "../support/task-workflow-helpers";
import { cleanupDirectMergeTaskState } from "../support/task-worktree-cleanup";
import type { TaskServiceUseCaseInput, TaskService } from "../task-service";

export const createTaskCompleteDirectMergeUseCase = ({
  devServerService,
  gitPort,
  taskStore,
  taskActivityGuard,
  settingsConfig,
  taskSessionLifecycleCoordinator,
  taskWorktreeService,
  terminalService,
  worktreeFiles,
}: TaskServiceUseCaseInput): Pick<TaskService, "completeDirectMerge"> => ({
  completeDirectMerge(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const dependencies = requireMergedTaskCleanupDependencies(
        {
          devServerService,
          gitPort,
          settingsConfig,
          taskWorktreeService,
          terminalService,
          worktreeFiles,
        },
        "task_direct_merge_complete",
      );
      const canonicalRepoPath = yield* dependencies.gitPort.canonicalizePath(repoPath);
      yield* taskSessionLifecycleCoordinator.acquireLifecycle(
        canonicalRepoPath,
        [taskId],
        "complete direct merge",
      );
      const { current, currentTasks } = yield* taskListWithCurrent(taskStore, repoPath, taskId);
      const metadata = yield* taskStore.getTaskMetadata({ repoPath, taskId });
      const directMerge = metadata.directMerge;
      if (directMerge === undefined) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "taskId",
            message: `Task ${taskId} does not have a locally applied direct merge to complete.`,
            details: { repoPath, taskId },
          }),
        );
      }

      if (metadata.agentSessions.length > 0) {
        if (!taskActivityGuard) {
          return yield* Effect.fail(
            new HostDependencyError({
              dependency: "taskActivityGuard",
              operation: "complete direct merge",
              message:
                "Task activity guard is required to check sessions before completing direct merge.",
            }),
          );
        }
        const { liveSessionCount } = yield* taskActivityGuard.countLiveSessions({
          repoPath: canonicalRepoPath,
          taskSessions: [{ taskId, sessions: metadata.agentSessions }],
        });
        if (liveSessionCount > 0) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "taskId",
              message: `Stop all running sessions for task ${taskId} before completing direct merge.`,
              details: { repoPath, taskId },
            }),
          );
        }
      }

      if (directMerge.targetBranch.remote !== undefined) {
        const currentBranch = yield* dependencies.gitPort.getCurrentBranch(repoPath);
        const currentBranchName = currentBranch.name?.trim();
        if (!currentBranchName) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "taskId",
              message: `Cannot finish the direct merge for task ${taskId} because the target branch checkout is not active.`,
              details: { repoPath, taskId },
            }),
          );
        }
        const expectedBranch = checkoutBranch(directMerge.targetBranch);
        if (currentBranchName !== expectedBranch) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "taskId",
              message: `Cannot finish the direct merge for task ${taskId} until branch ${expectedBranch} is checked out locally.`,
              details: { repoPath, taskId, expectedBranch, currentBranchName },
            }),
          );
        }

        const publishTargetRef = canonicalTargetBranch(directMerge.targetBranch);
        const publishSync = yield* dependencies.gitPort.commitsAheadBehind(
          repoPath,
          publishTargetRef,
        );
        if (publishSync.ahead !== 0 || publishSync.behind !== 0) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "taskId",
              message: `Cannot finish the direct merge for task ${taskId} until ${publishTargetRef} is fully published and synchronized.`,
              details: { repoPath, taskId, publishTargetRef },
            }),
          );
        }
      }

      let task = current;
      if (current.status !== "closed") {
        yield* validateTaskTransitionEffect(current, currentTasks, current.status, "closed");
      }
      yield* cleanupDirectMergeTaskState(dependencies, taskStore, repoPath, taskId, directMerge);
      if (current.status !== "closed") {
        task = yield* taskStore.transitionTask({ repoPath, taskId, status: "closed" });
      }
      const nextTasks = currentTasks.map((entry) => (entry.id === taskId ? task : entry));

      return enrichTask(task, nextTasks);
    }).pipe(Effect.scoped);
  },
});
