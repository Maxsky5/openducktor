import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { memo } from "react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import {
  type PullRequestReviewContextQueryInput,
  pullRequestReviewContextQueryOptions,
} from "@openducktor/frontend-core/queries/pull-request-review";
import {
  pullRequestReviewContextStateCopy,
  TASK_EXECUTION_CI_PANEL_COPY,
} from "@openducktor/frontend-core/review/task-execution-ci-panel-copy";
import { TaskExecutionCiLoaded } from "./task-execution-ci-checks-content";
import { TaskExecutionCiPanelState } from "./task-execution-ci-panel-state";

export type TaskExecutionCiChecksPanelModel = {
  isActive: boolean;
  queryInput: PullRequestReviewContextQueryInput | null;
  unavailableReason?: string | null;
};

const INACTIVE_QUERY_INPUT: PullRequestReviewContextQueryInput = {
  repoPath: "__inactive_pr_review__",
  taskId: "__inactive__",
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

  if (model.unavailableReason) {
    return (
      <TaskExecutionCiPanelState
        {...TASK_EXECUTION_CI_PANEL_COPY.providerUnavailable}
        detail={model.unavailableReason}
      />
    );
  }

  if (!queryInput) {
    return <TaskExecutionCiPanelState {...TASK_EXECUTION_CI_PANEL_COPY.noRepository} />;
  }

  if (reviewQuery.isLoading) {
    return <TaskExecutionCiPanelState {...TASK_EXECUTION_CI_PANEL_COPY.loading} />;
  }

  if (reviewQuery.isError) {
    return (
      <TaskExecutionCiPanelState
        {...TASK_EXECUTION_CI_PANEL_COPY.readFailed}
        detail={errorMessage(reviewQuery.error)}
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
        {...TASK_EXECUTION_CI_PANEL_COPY.noData}
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
        {...pullRequestReviewContextStateCopy(reviewQuery.data)}
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
