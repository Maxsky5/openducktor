import { ensurePullRequestManagementStatus, validateTransition } from "../../../domain/task";
import {
  canSkipRelinkedPullRequestCleanup,
  cleanupMergedBuilderState,
  loadBuilderBranchCleanup,
} from "../support/builder-worktree-cleanup";
import { requireLinkMergedPullRequestDependencies } from "../support/required-task-dependencies";
import { enrichTask, taskListWithCurrent } from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskLinkMergedPullRequestUseCase = ({
  devServerService,
  gitPort,
  taskStore,
  settingsConfig,
  taskWorktreeService,
  workspaceSettingsService,
}: CreateTaskServiceInput): Pick<TaskService, "linkMergedPullRequest"> => ({
  async linkMergedPullRequest(input) {
    const { repoPath, taskId, pullRequest } = input;

    const { current, currentTasks } = await taskListWithCurrent(taskStore, repoPath, taskId);
    const metadata = await taskStore.getTaskMetadata({ repoPath, taskId });
    const sameExistingPullRequest =
      metadata.pullRequest?.providerId === pullRequest.providerId &&
      metadata.pullRequest.number === pullRequest.number &&
      metadata.pullRequest.state === "merged";
    if (current.status === "closed" && sameExistingPullRequest) {
      return enrichTask(current, currentTasks);
    }

    const dependencies = requireLinkMergedPullRequestDependencies(
      devServerService,
      gitPort,
      settingsConfig,
      taskWorktreeService,
      workspaceSettingsService,
    );
    ensurePullRequestManagementStatus(current.status);
    if (metadata.directMerge !== undefined) {
      throw new Error(
        `A local direct merge is already recorded for task ${taskId}. Finish the direct merge workflow before linking a merged pull request.`,
      );
    }
    if (pullRequest.state !== "merged") {
      throw new Error(`Task ${taskId} can only link a merged pull request from detection results.`);
    }
    if (metadata.pullRequest !== undefined && !sameExistingPullRequest) {
      throw new Error(`Task ${taskId} already has a linked pull request.`);
    }

    let cleanup: { sourceBranch: string; targetBranch: string } | null = null;
    if (metadata.pullRequest === undefined) {
      cleanup = await loadBuilderBranchCleanup(
        dependencies,
        current,
        repoPath,
        taskId,
        "Pull request linking",
      );
    } else {
      try {
        cleanup = await loadBuilderBranchCleanup(
          dependencies,
          current,
          repoPath,
          taskId,
          "Pull request linking",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!canSkipRelinkedPullRequestCleanup(message)) {
          throw error;
        }
      }
    }

    await taskStore.setPullRequest({ repoPath, taskId, pullRequest });
    if (cleanup) {
      await cleanupMergedBuilderState(
        dependencies,
        taskStore,
        repoPath,
        taskId,
        cleanup.sourceBranch,
        cleanup.targetBranch,
      );
    }
    validateTransition(current, currentTasks, current.status, "closed");
    const task = await taskStore.transitionTask({ repoPath, taskId, status: "closed" });
    const nextTasks = currentTasks.map((entry) => (entry.id === taskId ? task : entry));

    return enrichTask(task, nextTasks);
  },
});
