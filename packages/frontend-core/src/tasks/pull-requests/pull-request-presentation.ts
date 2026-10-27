import { type BuiltinTaskCard as TaskCard } from "@openducktor/workflows";
import type {
  GitPullRequestState,
  PullRequest,
  RepositoryGitProviderContext,
} from "@openducktor/contracts";
import { pullRequestHealthError } from "../../review/git-provider-health";
import { canUnlinkTaskPullRequest } from "../presentation/task-display";

/** The short name of a pull request, such as "PR #42". */
export const pullRequestLabel = (pullRequest: Pick<PullRequest, "number">): string =>
  `PR #${pullRequest.number}`;

export const PULL_REQUEST_STATE_LABELS = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed_unmerged: "Closed",
} as const satisfies Record<GitPullRequestState, string>;

export const PULL_REQUEST_OPEN_FAILED_TITLE = "Failed to open pull request";

export const TASK_PULL_REQUEST_ACTION_LABELS = {
  detect: "Detect PR",
  detecting: "Detecting PR",
  unlink: "Unlink PR",
  unlinking: "Unlinking PR",
} as const;

/** Which pull request actions a task shows, and why Detect PR cannot run. */
export type TaskPullRequestActions = {
  showDetect: boolean;
  showUnlink: boolean;
  /** Why Detect PR is disabled, or null when it can run. */
  detectDisabledReason: string | null;
};

/**
 * Detect PR shows for a task without a pull request when the provider supports pull requests or
 * its read failed. Unlink PR shows for a linked pull request. Both need a task status that keeps
 * pull request data.
 */
export const resolveTaskPullRequestActions = (
  task: TaskCard,
  gitProviderContext: RepositoryGitProviderContext | undefined,
  gitProviderReadError: string | null,
): TaskPullRequestActions => {
  const supportsPullRequests =
    gitProviderContext?.descriptor.capabilities.supportsPullRequests === true;
  const readFailedWithoutContext = gitProviderContext == null && gitProviderReadError !== null;
  const statusAllows = canUnlinkTaskPullRequest(task);
  return {
    showDetect:
      (supportsPullRequests || readFailedWithoutContext) &&
      task.pullRequest == null &&
      statusAllows,
    showUnlink: task.pullRequest != null && statusAllows,
    detectDisabledReason: gitProviderReadError ?? pullRequestHealthError(gitProviderContext),
  };
};
