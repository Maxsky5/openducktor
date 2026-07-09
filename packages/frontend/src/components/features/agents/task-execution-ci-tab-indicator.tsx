import type { PullRequestReviewContext } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import {
  type PullRequestReviewContextQueryInput,
  pullRequestReviewContextQueryOptions,
} from "@/state/queries/pull-request-review";
import {
  type CiChecksIndicatorStatus,
  ciChecksIndicatorStatus,
} from "./task-execution-ci-presentation";

type LoadedPullRequestReviewContext = Extract<PullRequestReviewContext, { status: "loaded" }>;

export type TaskExecutionCiTabIndicator = {
  checkStatus: CiChecksIndicatorStatus | null;
  openThreadCount: number;
};

const inactiveCiReviewQueryInput = { repoPath: "__inactive_ci_header__" };

const ciCheckStatusDotClassName = {
  failure: "bg-rose-500",
  pending: "bg-amber-500",
  success: "bg-emerald-500",
} satisfies Record<CiChecksIndicatorStatus, string>;

const ciCheckStatusLabel = {
  failure: "failing checks",
  pending: "checks in progress",
  success: "passing checks",
} satisfies Record<CiChecksIndicatorStatus, string>;

const formatOpenThreadCount = (count: number): string => (count > 99 ? "99+" : String(count));
const openThreadLabel = (count: number): string =>
  `${count} open review ${count === 1 ? "thread" : "threads"}`;

const buildCiTabIndicator = (
  context: LoadedPullRequestReviewContext,
): TaskExecutionCiTabIndicator => ({
  checkStatus: ciChecksIndicatorStatus(context.checks),
  openThreadCount: context.reviewThreads.openCount,
});

export const ciTabAriaLabel = (
  label: string,
  indicator: TaskExecutionCiTabIndicator | null,
): string => {
  if (!indicator) {
    return label;
  }

  const labelParts = [label];
  if (indicator.checkStatus) {
    labelParts.push(ciCheckStatusLabel[indicator.checkStatus]);
  }
  if (indicator.openThreadCount > 0) {
    labelParts.push(openThreadLabel(indicator.openThreadCount));
  }
  return labelParts.join(", ");
};

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
          className="absolute -left-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground ring-2 ring-card"
          data-testid="task-execution-tab-ci-open-threads"
        >
          {formatOpenThreadCount(indicator.openThreadCount)}
        </span>
      ) : null}
      {indicator.checkStatus ? (
        <span
          aria-hidden="true"
          className={cn(
            "absolute right-0.5 top-0.5 size-2.5 rounded-full ring-2 ring-card",
            ciCheckStatusDotClassName[indicator.checkStatus],
          )}
          data-testid="task-execution-tab-ci-check-status"
        />
      ) : null}
    </>
  );
}
