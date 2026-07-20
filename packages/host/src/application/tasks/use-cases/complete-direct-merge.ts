import { Effect } from "effect";
import { canonicalTargetBranch, checkoutBranch } from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";
import { cleanupDirectMergeBuilderState } from "../support/builder-worktree-cleanup";
import { requireMergedBuilderCleanupDependencies } from "../support/required-task-dependencies";
import { completeTaskClosure } from "../support/task-closure";
import { validateTaskTransitionEffect } from "../support/task-validation-effects";
import { enrichTask, taskListWithCurrent } from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskCompleteDirectMergeUseCase = ({
  devServerService,
  gitPort,
  taskStore,
  settingsConfig,
  taskSessionBootstrapCoordinator,
  taskWorktreeService,
  terminalService,
}: CreateTaskServiceInput): Pick<TaskService, "completeDirectMerge"> => ({
  completeDirectMerge(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId } = input;
      const dependencies = requireMergedBuilderCleanupDependencies(
        { devServerService, gitPort, settingsConfig, taskWorktreeService, terminalService },
        "task_direct_merge_complete",
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
      const cleanup = cleanupDirectMergeBuilderState(
        dependencies,
        taskStore,
        repoPath,
        taskId,
        directMerge,
      );
      if (current.status !== "closed") {
        yield* validateTaskTransitionEffect(current, currentTasks, current.status, "closed");
        task = yield* completeTaskClosure({
          cleanup,
          gitPort: dependencies.gitPort,
          operation: "complete direct merge",
          repoPath,
          taskId,
          taskSessionBootstrapCoordinator,
          taskStore,
        });
      } else {
        yield* Effect.scoped(cleanup);
      }
      const nextTasks = currentTasks.map((entry) => (entry.id === taskId ? task : entry));

      return enrichTask(task, nextTasks);
    });
  },
});
