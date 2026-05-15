import { ensurePullRequestManagementStatus } from "../../../domain/task";
import { loadBuilderBranchCleanup } from "../support/builder-worktree-cleanup";
import {
  findGithubPullRequestForBranch,
  requireGithubPullRequestContext,
} from "../support/github-pull-requests";
import { requirePullRequestDetectionDependencies } from "../support/required-task-dependencies";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskPullRequestDetectionUseCase = ({
  gitPort,
  taskStore,
  systemCommands,
  taskWorktreeService,
  workspaceSettingsService,
}: CreateTaskServiceInput): Pick<TaskService, "detectPullRequest"> => ({
  async detectPullRequest(input) {
    const { repoPath, taskId } = input;
    const dependencies = requirePullRequestDetectionDependencies(
      gitPort,
      systemCommands,
      taskWorktreeService,
      workspaceSettingsService,
    );
    const current = await taskStore.getTask({ repoPath, taskId });
    ensurePullRequestManagementStatus(current.status);
    const metadata = await taskStore.getTaskMetadata({ repoPath, taskId });
    if (metadata.pullRequest !== undefined) {
      throw new Error(`Task ${taskId} already has a linked pull request.`);
    }
    if (metadata.directMerge !== undefined) {
      throw new Error(
        `A local direct merge is already recorded for task ${taskId}. Finish the direct merge workflow before linking a merged pull request.`,
      );
    }

    const repoConfig =
      await dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
    const effectiveRepoPath = repoConfig.repoPath;
    const builderContext = await loadBuilderBranchCleanup(
      dependencies,
      current,
      effectiveRepoPath,
      taskId,
      "Pull request detection",
    );
    const githubContext = await requireGithubPullRequestContext(
      dependencies,
      effectiveRepoPath,
      repoConfig,
    );
    const openPullRequest = await findGithubPullRequestForBranch(
      dependencies,
      effectiveRepoPath,
      githubContext,
      builderContext.sourceBranch,
      "open",
    );
    if (openPullRequest !== undefined) {
      await taskStore.setPullRequest({
        repoPath: effectiveRepoPath,
        taskId,
        pullRequest: openPullRequest.record,
      });
      return {
        outcome: "linked",
        pullRequest: openPullRequest.record,
      };
    }

    const pullRequest = await findGithubPullRequestForBranch(
      dependencies,
      effectiveRepoPath,
      githubContext,
      builderContext.sourceBranch,
      "all",
    );
    if (pullRequest?.record.state === "merged") {
      return {
        outcome: "merged",
        pullRequest: pullRequest.record,
      };
    }

    return {
      outcome: "not_found",
      sourceBranch: builderContext.sourceBranch,
      targetBranch: builderContext.targetBranch,
    };
  },
});
