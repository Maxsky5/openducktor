import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import {
  type PullRequestReviewContextQueryInput,
  pullRequestReviewContextQueryOptions,
} from "@/state/queries/pull-request-review";
import type { CiChecksIndicatorStatus } from "./task-execution-ci-presentation";
import {
  buildCiTabIndicator,
  formatOpenThreadCount,
  type TaskExecutionCiTabIndicator,
} from "./task-execution-ci-tab-indicator-model";

const inactiveCiReviewQueryInput = { repoPath: "__inactive_ci_header__" };

const ciCheckStatusDotClassName = {
  failure: "bg-rose-500",
  pending: "bg-sky-500",
  success: "bg-emerald-500",
} satisfies Record<CiChecksIndicatorStatus, string>;

export const useTaskExecutionCiTabIndicator = (
  queryInput: PullRequestReviewContextQueryInput | null | undefined,
): TaskExecutionCiTabIndicator | null => {
  const ciReviewQuery = useQuery({
    ...pullRequestReviewContextQueryOptions(queryInput ?? inactiveCiReviewQueryInput),
    enabled: false,
  });

  return ciReviewQuery.data?.status === "loaded" ? buildCiTabIndicator(ciReviewQuery.data) : null;
};

export function TaskExecutionCiTabIconOverlay({
  indicator,
}: {
  indicator: TaskExecutionCiTabIndicator | null;
}): ReactElement | null {
  if (!indicator) {
    return null;
  }

  return (
    <>
      {indicator.openThreadCount > 0 ? (
        <span
          aria-hidden="true"
          className="absolute -left-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-warning-surface px-1 text-[9px] font-semibold leading-none text-warning-surface-foreground ring-1 ring-card"
          data-testid="task-execution-tab-ci-open-threads"
        >
          {formatOpenThreadCount(indicator.openThreadCount)}
        </span>
      ) : null}
      {indicator.checkStatus ? (
        <span
          aria-hidden="true"
          className={cn(
            "absolute right-0.5 top-0.5 size-1.5 rounded-full ring-1 ring-card",
            ciCheckStatusDotClassName[indicator.checkStatus],
          )}
          data-testid="task-execution-tab-ci-check-status"
        />
      ) : null}
    </>
  );
}
