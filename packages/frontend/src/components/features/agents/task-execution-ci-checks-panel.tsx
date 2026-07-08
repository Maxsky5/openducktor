import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { errorMessage } from "@/lib/errors";
import { pullRequestReviewContextQueryOptions } from "@/state/queries/pull-request-review";
import { TaskExecutionCiLoaded } from "./task-execution-ci-checks-content";
import { TaskExecutionCiPanelState } from "./task-execution-ci-panel-state";

export type TaskExecutionCiChecksPanelModel = {
  isActive: boolean;
  queryInput: {
    repoPath: string;
    taskId?: string;
    workingDirectory?: string;
  } | null;
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
    return <TaskExecutionCiPanelState message="No repository is selected." />;
  }

  if (reviewQuery.isLoading) {
    return <TaskExecutionCiPanelState message="Loading CI checks..." />;
  }

  if (reviewQuery.isError) {
    return <TaskExecutionCiPanelState message={errorMessage(reviewQuery.error)} />;
  }

  if (!reviewQuery.data) {
    return <TaskExecutionCiPanelState message="No CI check data loaded." />;
  }

  if (reviewQuery.data.status !== "loaded") {
    return <TaskExecutionCiPanelState message={reviewQuery.data.reason} />;
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
