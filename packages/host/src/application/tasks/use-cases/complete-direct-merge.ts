import { canonicalTargetBranch, checkoutBranch, validateTransition } from "../../../domain/task";
import { cleanupDirectMergeBuilderState } from "../support/builder-worktree-cleanup";
import { requireDirectMergeCompleteDependencies } from "../support/required-task-dependencies";
import { enrichTask, taskListWithCurrent } from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskCompleteDirectMergeUseCase = ({
  devServerService,
  gitPort,
  taskStore,
  settingsConfig,
  taskWorktreeService,
}: CreateTaskServiceInput): Pick<TaskService, "completeDirectMerge"> => ({
  async completeDirectMerge(input) {
    const { repoPath, taskId } = input;
    const dependencies = requireDirectMergeCompleteDependencies(
      devServerService,
      gitPort,
      settingsConfig,
      taskWorktreeService,
    );
    const { current, currentTasks } = await taskListWithCurrent(taskStore, repoPath, taskId);
    const metadata = await taskStore.getTaskMetadata({ repoPath, taskId });
    const directMerge = metadata.directMerge;
    if (directMerge === undefined) {
      throw new Error(`Task ${taskId} does not have a locally applied direct merge to complete.`);
    }

    if (directMerge.targetBranch.remote !== undefined) {
      const currentBranch = await dependencies.gitPort.getCurrentBranch(repoPath);
      const currentBranchName = currentBranch.name?.trim();
      if (!currentBranchName) {
        throw new Error(
          `Cannot finish the direct merge for task ${taskId} because the target branch checkout is not active.`,
        );
      }
      const expectedBranch = checkoutBranch(directMerge.targetBranch);
      if (currentBranchName !== expectedBranch) {
        throw new Error(
          `Cannot finish the direct merge for task ${taskId} until branch ${expectedBranch} is checked out locally.`,
        );
      }

      const publishTargetRef = canonicalTargetBranch(directMerge.targetBranch);
      const publishSync = await dependencies.gitPort.commitsAheadBehind(repoPath, publishTargetRef);
      if (publishSync.ahead !== 0 || publishSync.behind !== 0) {
        throw new Error(
          `Cannot finish the direct merge for task ${taskId} until ${publishTargetRef} is fully published and synchronized.`,
        );
      }
    }

    let task = current;
    if (current.status !== "closed") {
      validateTransition(current, currentTasks, current.status, "closed");
      task = await taskStore.transitionTask({ repoPath, taskId, status: "closed" });
    }
    await cleanupDirectMergeBuilderState(dependencies, taskStore, repoPath, taskId, directMerge);
    const nextTasks = currentTasks.map((entry) => (entry.id === taskId ? task : entry));

    return enrichTask(task, nextTasks);
  },
});
