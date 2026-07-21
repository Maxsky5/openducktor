import type { PullRequestReviewContext } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { memo } from "react";
import { errorMessage } from "@/lib/errors";
import {
  type PullRequestReviewContextQueryInput,
  pullRequestReviewContextQueryOptions,
} from "@/state/queries/pull-request-review";
import { TaskExecutionCiLoaded } from "./task-execution-ci-checks-content";
import {
  TaskExecutionCiPanelState,
  type TaskExecutionCiPanelStateProps,
} from "./task-execution-ci-panel-state";

export type TaskExecutionCiChecksPanelModel = {
  isActive: boolean;
  queryInput: PullRequestReviewContextQueryInput | null;
};

type NonLoadedPullRequestReviewContext = Exclude<PullRequestReviewContext, { status: "loaded" }>;

const INACTIVE_QUERY_INPUT: PullRequestReviewContextQueryInput = {
  repoPath: "__inactive_pr_review__",
  taskId: "__inactive__",
};

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

export const TaskExecutionCiChecksPanel = memo(function TaskExecutionCiChecksPanel({
  model,
}: {
  model: TaskExecutionCiChecksPanelModel;
}): ReactElement {
  const queryInput = model.queryInput;
  const reviewQuery = useQuery({
    ...pullRequestReviewContextQueryOptions(queryInput ?? INACTIVE_QUERY_INPUT),
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
        message="Reading the current pull request, check runs, and review threads."
        kind="loading"
      />
    );
  }

  if (reviewQuery.isError) {
    return (
      <TaskExecutionCiPanelState
        title="Could not load CI checks"
        message="OpenDucktor could not read pull request review data."
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
});
