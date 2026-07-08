import type { PullRequestReviewContext } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { errorMessage } from "@/lib/errors";
import { pullRequestReviewContextQueryOptions } from "@/state/queries/pull-request-review";
import { TaskExecutionCiLoaded } from "./task-execution-ci-checks-content";
import {
  TaskExecutionCiPanelState,
  type TaskExecutionCiPanelStateProps,
} from "./task-execution-ci-panel-state";

export type TaskExecutionCiChecksPanelModel = {
  isActive: boolean;
  queryInput: {
    repoPath: string;
    taskId?: string;
    workingDirectory?: string;
  } | null;
};

type NonLoadedPullRequestReviewContext = Exclude<PullRequestReviewContext, { status: "loaded" }>;

const pullRequestStateProps = (
  context: NonLoadedPullRequestReviewContext,
): TaskExecutionCiPanelStateProps => {
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
      message: "GitHub returned an error while reading pull request checks or review comments.",
      kind: "error",
      detail: context.reason,
    };
  }

  return {
    title: "GitHub checks unavailable",
    message: "Check the repository GitHub integration, GitHub CLI, and authentication.",
    kind: "unavailable",
    detail: context.reason,
  };
};

export function TaskExecutionCiChecksPanel({
  model,
}: {
  model: TaskExecutionCiChecksPanelModel;
}): ReactElement {
  const queryInput = model.queryInput;
  const reviewQuery = useQuery({
    ...pullRequestReviewContextQueryOptions(queryInput ?? { repoPath: "__inactive_pr_review__" }),
    enabled: model.isActive && queryInput !== null,
  });

  if (!queryInput) {
    return (
      <TaskExecutionCiPanelState
        title="No repository selected"
        message="Open a task in a repository to load pull request checks and review comments."
      />
    );
  }

  if (reviewQuery.isLoading) {
    return (
      <TaskExecutionCiPanelState
        title="Loading CI checks"
        message="Reading the current pull request, check runs, and review threads from GitHub."
        kind="loading"
      />
    );
  }

  if (reviewQuery.isError) {
    return (
      <TaskExecutionCiPanelState
        title="Could not load CI checks"
        message="OpenDucktor could not read pull request review data from GitHub."
        detail={errorMessage(reviewQuery.error)}
        kind="error"
        actionLabel="Retry"
        actionPendingLabel="Retrying"
        isActionPending={reviewQuery.isFetching}
        onAction={() => {
          void reviewQuery.refetch();
        }}
      />
    );
  }

  if (!reviewQuery.data) {
    return (
      <TaskExecutionCiPanelState
        title="No CI data loaded"
        message="OpenDucktor has not received a pull request review snapshot yet."
        actionLabel="Retry"
        actionPendingLabel="Retrying"
        isActionPending={reviewQuery.isFetching}
        onAction={() => {
          void reviewQuery.refetch();
        }}
      />
    );
  }

  if (reviewQuery.data.status !== "loaded") {
    return (
      <TaskExecutionCiPanelState
        {...pullRequestStateProps(reviewQuery.data)}
        actionLabel="Refresh"
        actionPendingLabel="Refreshing"
        isActionPending={reviewQuery.isFetching}
        onAction={() => {
          void reviewQuery.refetch();
        }}
      />
    );
  }

  return (
    <TaskExecutionCiLoaded
      context={reviewQuery.data}
      refreshState={reviewQuery.isFetching ? "refreshing" : "idle"}
      onRefresh={() => {
        void reviewQuery.refetch();
      }}
    />
  );
}
