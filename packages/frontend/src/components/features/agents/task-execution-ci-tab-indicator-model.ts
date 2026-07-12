import type { PullRequestReviewContext } from "@openducktor/contracts";
import {
  type CiChecksIndicatorStatus,
  ciChecksIndicatorStatus,
} from "./task-execution-ci-presentation";

type LoadedPullRequestReviewContext = Extract<PullRequestReviewContext, { status: "loaded" }>;

export type TaskExecutionCiTabIndicator = {
  checkStatus: CiChecksIndicatorStatus | null;
  openThreadCount: number;
};

const ciCheckStatusLabel = {
  failure: "failing checks",
  pending: "checks in progress",
  success: "passing checks",
} satisfies Record<CiChecksIndicatorStatus, string>;

const openThreadLabel = (count: number): string =>
  `${count} open review ${count === 1 ? "thread" : "threads"}`;

export const formatOpenThreadCount = (count: number): string =>
  count > 99 ? "99+" : String(count);

export const buildCiTabIndicator = (
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
