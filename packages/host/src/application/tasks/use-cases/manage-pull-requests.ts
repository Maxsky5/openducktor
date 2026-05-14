import {
  ensureCleanBuilderWorktree,
  ensurePullRequestManagementStatus,
} from "../../../domain/task";
import { loadOpenApprovalContext } from "../support/approval-readiness";
import {
  fetchGithubPullRequestByNumber,
  GITHUB_PROVIDER_ID,
  requireGithubPullRequestContext,
  upsertGithubPullRequest,
} from "../support/github-pull-requests";
import {
  requirePullRequestLinkDependencies,
  requirePullRequestUpsertDependencies,
} from "../support/required-task-dependencies";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskPullRequestManagementUseCases = ({
  gitPort,
  taskStore,
  settingsConfig,
  systemCommands,
  taskWorktreeService,
  workspaceSettingsService,
}: CreateTaskServiceInput): Pick<
  TaskService,
  "linkPullRequest" | "upsertPullRequest" | "unlinkPullRequest"
> => ({
  async linkPullRequest(input) {
    const { repoPath, taskId, providerId, number } = input;
    if (providerId !== GITHUB_PROVIDER_ID) {
      throw new Error(
        `Unsupported pull request provider for task_pull_request_link: ${providerId}`,
      );
    }
    const dependencies = requirePullRequestLinkDependencies(
      gitPort,
      systemCommands,
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
        `A local direct merge is already recorded for task ${taskId}. Finish the direct merge workflow before linking a pull request.`,
      );
    }

    const repoConfig =
      await dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
    const effectiveRepoPath = repoConfig.repoPath;
    const githubContext = await requireGithubPullRequestContext(
      dependencies,
      effectiveRepoPath,
      repoConfig,
    );
    const pullRequest = await fetchGithubPullRequestByNumber(
      dependencies,
      effectiveRepoPath,
      githubContext,
      number,
    );
    await taskStore.setPullRequest({
      repoPath: effectiveRepoPath,
      taskId,
      pullRequest: pullRequest.record,
    });

    return pullRequest.record;
  },

  async upsertPullRequest(input) {
    const { repoPath, taskId, content } = input;
    const dependencies = requirePullRequestUpsertDependencies(
      gitPort,
      settingsConfig,
      systemCommands,
      taskWorktreeService,
      workspaceSettingsService,
    );
    const current = await taskStore.getTask({ repoPath, taskId });
    const repoConfig =
      await dependencies.workspaceSettingsService.getRepoConfigByRepoPath(repoPath);
    const effectiveRepoPath = repoConfig.repoPath;
    const metadata = await taskStore.getTaskMetadata({ repoPath: effectiveRepoPath, taskId });
    if (metadata.directMerge !== undefined) {
      throw new Error(
        `A local direct merge is already recorded for task ${taskId}. Finish or discard that direct merge workflow before opening a pull request.`,
      );
    }

    const approval = await loadOpenApprovalContext(
      dependencies,
      taskId,
      current,
      metadata,
      repoConfig,
    );
    ensureCleanBuilderWorktree(approval);
    if (!approval.workingDirectory) {
      throw new Error(
        `Human approval requires a builder worktree for task ${taskId}. Start Builder first.`,
      );
    }

    const githubContext = await requireGithubPullRequestContext(
      dependencies,
      effectiveRepoPath,
      repoConfig,
    );
    const pushResult = await dependencies.gitPort.pushBranch(
      approval.workingDirectory,
      approval.sourceBranch,
      {
        remote: githubContext.remoteName,
        setUpstream: true,
        forceWithLease: false,
      },
    );
    if (pushResult.outcome === "rejected_non_fast_forward") {
      throw new Error(
        `Failed to push the builder branch before creating the pull request: ${pushResult.output}`,
      );
    }

    const pullRequest = await upsertGithubPullRequest(
      dependencies,
      effectiveRepoPath,
      githubContext,
      approval,
      content.title,
      content.body,
    );
    await taskStore.setPullRequest({ repoPath: effectiveRepoPath, taskId, pullRequest });

    return pullRequest;
  },

  async unlinkPullRequest(input) {
    const { repoPath, taskId } = input;
    const current = await taskStore.getTask({ repoPath, taskId });
    ensurePullRequestManagementStatus(current.status);
    const metadata = await taskStore.getTaskMetadata({ repoPath, taskId });
    if (metadata.pullRequest === undefined) {
      throw new Error(`Task ${taskId} does not have a linked pull request.`);
    }

    return taskStore.setPullRequest({ repoPath, taskId, pullRequest: null });
  },
});
