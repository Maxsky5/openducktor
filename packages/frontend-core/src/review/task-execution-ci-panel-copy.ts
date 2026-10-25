import type { PullRequestReviewContext } from "@openducktor/contracts";

export type TaskExecutionCiPanelStateKind = "empty" | "error" | "loading" | "unavailable";

export type TaskExecutionCiPanelStateCopy = {
  title: string;
  message: string;
  kind: TaskExecutionCiPanelStateKind;
  detail?: string;
};

/** The states of the CI Checks view before it shows a loaded pull request. */
export const TASK_EXECUTION_CI_PANEL_COPY = {
  providerUnavailable: {
    title: "Pull request checks unavailable",
    message: "The configured Git provider cannot load CI checks or review comments.",
    kind: "unavailable",
  },
  noRepository: {
    title: "No repository selected",
    message: "Open a task in a repository to load pull request checks and review comments.",
    kind: "empty",
  },
  loading: {
    title: "Loading CI checks",
    message: "Reading the current pull request, check runs, and review threads.",
    kind: "loading",
  },
  readFailed: {
    title: "Could not load CI checks",
    message: "OpenDucktor could not read pull request review data.",
    kind: "error",
  },
  noData: {
    title: "No CI data loaded",
    message: "OpenDucktor has not received a pull request review snapshot yet.",
    kind: "empty",
  },
  noLinkedPullRequest: {
    title: "No pull request found",
    message: "Create or link a pull request for this branch to see CI checks and review comments.",
    kind: "empty",
  },
  reviewUnsupported: {
    title: "Pull request checks unavailable",
    message: "The Git provider of this repository does not support pull request review.",
    kind: "unavailable",
  },
} satisfies Record<string, TaskExecutionCiPanelStateCopy>;

type NonLoadedPullRequestReviewContext = Exclude<PullRequestReviewContext, { status: "loaded" }>;

/** The state of a review context that has no loaded pull request. */
export const pullRequestReviewContextStateCopy = (
  context: NonLoadedPullRequestReviewContext,
): TaskExecutionCiPanelStateCopy => {
  if (context.status === "no_pull_request") {
    return {
      title: "No pull request found",
      message:
        "Create or link a pull request for this branch to see CI checks and review comments.",
      kind: "empty",
      detail: context.reason,
    };
  }

  if (context.status === "error") {
    return {
      title: "Could not load CI checks",
      message:
        "The pull request provider returned an error while reading checks or review comments.",
      kind: "error",
      detail: context.reason,
    };
  }

  return {
    title: "Pull request checks unavailable",
    message: "Check the repository provider integration, command-line tool, and authentication.",
    kind: "unavailable",
    detail: context.reason,
  };
};
