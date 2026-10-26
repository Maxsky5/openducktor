import type {
  PullRequest,
  PullRequestReviewActivity,
  PullRequestReviewAggregateStatus,
  PullRequestReviewCheck,
  PullRequestReviewContext,
  RepositoryGitProviderContext,
} from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { PullRequestReviewContextQueryInput } from "@openducktor/frontend-core/queries/pull-request-review";
import { gitProviderReadError } from "@openducktor/frontend-core/review/git-provider-health";
import { formatCiRelativeTime } from "@openducktor/frontend-core/review/task-execution-ci-relative-time-format";
import {
  checksSummaryLabel,
  isFailingCheck,
  isPendingCheck,
} from "@openducktor/frontend-core/review/task-execution-ci-presentation";
import { humanDate } from "@openducktor/frontend-core/tasks/presentation/task-display";
import {
  countPullRequestComments,
  filterPullRequestComments,
  type PullRequestCommentAuthorFilter,
  type PullRequestCommentCounts,
} from "@openducktor/frontend-core/review/pull-request-comment-filters";
import { resolvePullRequestReviewAvailability } from "@openducktor/frontend-core/review/pull-request-review-availability";
import {
  pullRequestReviewContextStateCopy,
  TASK_EXECUTION_CI_PANEL_COPY,
  type TaskExecutionCiPanelStateCopy,
} from "@openducktor/frontend-core/review/task-execution-ci-panel-copy";

export type LoadedPullRequestReviewContext = Extract<
  PullRequestReviewContext,
  { status: "loaded" }
>;

export type CiChecksStateAction = "retry" | "refresh";

/** What the CI Checks view shows before or instead of a loaded pull request. */
export type CiChecksViewState =
  | { kind: "loading"; copy: TaskExecutionCiPanelStateCopy }
  | {
      kind: "state";
      copy: TaskExecutionCiPanelStateCopy;
      /**
       * The action that reads the review again, with the desktop label: Retry after a failed or
       * empty read, Refresh for a provider state. Null when a read cannot change the state.
       */
      action: CiChecksStateAction | null;
    }
  | {
      kind: "loaded";
      context: LoadedPullRequestReviewContext;
      /**
       * Why the last read of the review failed. The view still shows the last loaded review, so
       * it must tell that the review can be out of date.
       */
      refreshError: string | null;
    };

type Read<Data> = { data: Data | undefined; error: Error | null; isPending: boolean };

const READING_PROVIDER: TaskExecutionCiPanelStateCopy = {
  title: "Reading the Git provider",
  message: "Checking whether the repository provider can read pull request reviews.",
  kind: "loading",
};

const withDetail = (
  copy: TaskExecutionCiPanelStateCopy,
  detail: string | null | undefined,
): TaskExecutionCiPanelStateCopy => (detail ? { ...copy, detail } : copy);

/** The review query of a task, as desktop builds it: only for a linked pull request it can read. */
export const ciReviewQueryInput = ({
  repoPath,
  taskId,
  pullRequest,
  unavailableReason,
}: {
  repoPath: string;
  taskId: string;
  pullRequest: PullRequest | undefined;
  unavailableReason: string | null;
}): PullRequestReviewContextQueryInput | null =>
  pullRequest && unavailableReason === null
    ? {
        repoPath,
        taskId,
        pullRequest: { providerId: pullRequest.providerId, number: pullRequest.number },
      }
    : null;

/** The availability of the review: the desktop rule with the provider read of this view. */
export const ciReviewAvailability = (
  provider: Read<RepositoryGitProviderContext>,
  pullRequest: PullRequest | undefined,
) =>
  resolvePullRequestReviewAvailability({
    gitProviderContext: provider.data,
    gitProviderReadError: gitProviderReadError(provider.error),
    linkedPullRequest: pullRequest,
  });

/** The state of the CI Checks view from the provider and the review reads. */
export const ciChecksViewState = ({
  provider,
  pullRequest,
  review,
}: {
  provider: Read<RepositoryGitProviderContext>;
  pullRequest: PullRequest | undefined;
  review: Read<PullRequestReviewContext>;
}): CiChecksViewState => {
  if (provider.data === undefined && provider.error === null) {
    return { kind: "loading", copy: READING_PROVIDER };
  }
  const availability = ciReviewAvailability(provider, pullRequest);
  if (availability.unavailableReason) {
    return {
      kind: "state",
      copy: withDetail(
        TASK_EXECUTION_CI_PANEL_COPY.providerUnavailable,
        availability.unavailableReason,
      ),
      // A failed provider read can work on the next read.
      action: provider.error === null ? null : "retry",
    };
  }
  if (!availability.canShowPullRequestReview) {
    return { kind: "state", copy: TASK_EXECUTION_CI_PANEL_COPY.reviewUnsupported, action: null };
  }
  if (!availability.hasLinkedPullRequest) {
    return {
      kind: "state",
      copy: TASK_EXECUTION_CI_PANEL_COPY.noLinkedPullRequest,
      action: null,
    };
  }
  if (review.data === undefined) {
    if (review.error) {
      return {
        kind: "state",
        copy: withDetail(TASK_EXECUTION_CI_PANEL_COPY.readFailed, errorMessage(review.error)),
        action: "retry",
      };
    }
    return review.isPending
      ? { kind: "loading", copy: TASK_EXECUTION_CI_PANEL_COPY.loading }
      : { kind: "state", copy: TASK_EXECUTION_CI_PANEL_COPY.noData, action: "retry" };
  }
  if (review.data.status !== "loaded") {
    return {
      kind: "state",
      copy: pullRequestReviewContextStateCopy(review.data),
      action: "refresh",
    };
  }
  return {
    kind: "loaded",
    context: review.data,
    refreshError: review.error ? errorMessage(review.error) : null,
  };
};

/** The status group of a check. Failed checks list first, skipped checks last. */
type CheckGroup = "failed" | "pending" | "neutral" | "passed" | "skipped";

const CHECK_GROUP_ORDER: readonly CheckGroup[] = [
  "failed",
  "pending",
  "neutral",
  "passed",
  "skipped",
];

/** The group of a check, with the desktop rules for failing and pending checks. */
const checkGroup = (check: PullRequestReviewCheck): CheckGroup => {
  if (isFailingCheck(check)) return "failed";
  if (isPendingCheck(check)) return "pending";
  if (check.status === "completed" && check.conclusion === "success") return "passed";
  if (check.status === "completed" && check.conclusion === "skipped") return "skipped";
  return "neutral";
};

const SECOND_MS = 1000;

/** A run time such as "45s", "2m 14s", or "1h 5m". */
export const formatCheckDuration = (durationMs: number): string => {
  const seconds = Math.max(0, Math.round(durationMs / SECOND_MS));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 === 0 ? `${minutes}m` : `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
};

/**
 * The time of a check: the run time of a completed check, or the start of a running check. Null
 * when the provider reports no start time.
 */
export const checkTimeLabel = (check: PullRequestReviewCheck, now: number): string | null => {
  if (check.startedAt === null) return null;
  const started = Date.parse(check.startedAt);
  if (!Number.isFinite(started)) return null;
  if (check.completedAt !== null) {
    const completed = Date.parse(check.completedAt);
    return Number.isFinite(completed) ? formatCheckDuration(completed - started) : null;
  }
  return isPendingCheck(check) ? `Started ${formatCiRelativeTime(check.startedAt, now)}` : null;
};

/** One line of the details of an opened check, as the desktop check card. */
export type CheckDetail = { label: string; value: string; mono: boolean };

/**
 * The details of an opened check: the workflow, the provider details, the start and end times,
 * and the run time of a completed check.
 */
export const checkDetails = (check: PullRequestReviewCheck, now: number): CheckDetail[] => {
  const details: CheckDetail[] = [];
  if (check.workflow) details.push({ label: "Workflow", value: check.workflow, mono: false });
  if (check.details) details.push({ label: "Details", value: check.details, mono: false });
  if (check.startedAt) {
    details.push({ label: "Started", value: humanDate(check.startedAt), mono: false });
  }
  if (check.completedAt) {
    details.push({ label: "Completed", value: humanDate(check.completedAt), mono: false });
    const duration = checkTimeLabel(check, now);
    if (duration) details.push({ label: "Duration", value: duration, mono: false });
  }
  return details;
};

/** The open state of the Checks and Comments sections. Both start open, as on desktop. */
export type ChecksSections = { checks: boolean; comments: boolean };

export const OPEN_CHECKS_SECTIONS: ChecksSections = { checks: true, comments: true };

export type ChecksListItem =
  | {
      kind: "checks_header";
      key: "checks_header";
      aggregateStatus: PullRequestReviewAggregateStatus;
      /** Such as "1 failing", from the desktop summary. */
      summary: string;
      count: number;
      open: boolean;
    }
  | { kind: "check"; key: string; check: PullRequestReviewCheck; group: CheckGroup }
  | { kind: "no_checks"; key: "no_checks" }
  | {
      kind: "comments_header";
      key: "comments_header";
      counts: PullRequestCommentCounts;
      total: number;
      open: boolean;
    }
  | { kind: "comment"; key: string; comment: PullRequestReviewActivity }
  | { kind: "no_comments"; key: "no_comments"; text: string };

/**
 * The checks with failed checks first. Each group keeps the provider order of its checks. A check
 * keys on its workflow and name, so its open state stays when the provider adds or moves checks.
 * A second check with the same workflow and name in one read gets a count in its key.
 */
const sortedCheckItems = (checks: readonly PullRequestReviewCheck[]): ChecksListItem[] => {
  const grouped = new Map<CheckGroup, ChecksListItem[]>();
  const occurrences = new Map<string, number>();
  for (const check of checks) {
    const identity = JSON.stringify([check.workflow, check.name]);
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    const group = checkGroup(check);
    const item: ChecksListItem = {
      kind: "check",
      key: occurrence === 0 ? `check:${identity}` : `check:${identity}:${occurrence}`,
      check,
      group,
    };
    const items = grouped.get(group);
    if (items) items.push(item);
    else grouped.set(group, [item]);
  }
  return CHECK_GROUP_ORDER.flatMap((group) => grouped.get(group) ?? []);
};

/**
 * The rows of a loaded review, as the two desktop sections. Checks lists the checks with failed
 * checks first. Comments lists the shown comments of the author filter. A closed section shows
 * only its header.
 */
export const buildChecksListItems = (
  context: LoadedPullRequestReviewContext,
  filter: PullRequestCommentAuthorFilter,
  hideResolved: boolean,
  sections: ChecksSections = OPEN_CHECKS_SECTIONS,
): ChecksListItem[] => {
  const items: ChecksListItem[] = [
    {
      kind: "checks_header",
      key: "checks_header",
      aggregateStatus: context.aggregateStatus,
      summary: checksSummaryLabel(context.checks),
      count: context.checks.length,
      open: sections.checks,
    },
  ];
  if (sections.checks) {
    if (context.checks.length === 0) items.push({ kind: "no_checks", key: "no_checks" });
    else items.push(...sortedCheckItems(context.checks));
  }
  items.push({
    kind: "comments_header",
    key: "comments_header",
    counts: countPullRequestComments(context.comments, hideResolved),
    total: context.comments.length,
    open: sections.comments,
  });
  if (!sections.comments) return items;
  if (context.comments.length === 0) {
    items.push({ kind: "no_comments", key: "no_comments", text: "No comments reported." });
    return items;
  }
  const shown = filterPullRequestComments(context.comments, filter, hideResolved);
  if (shown.length === 0) {
    items.push({ kind: "no_comments", key: "no_comments", text: "No comments for this filter." });
  }
  for (const comment of shown)
    items.push({ kind: "comment", key: `comment:${comment.id}`, comment });
  return items;
};

/**
 * The open state of a comment card. An unresolved comment starts open and a resolved one
 * closed. A choice of the user holds until the resolution of the comment changes.
 */
export const isCommentOpen = (
  comment: Pick<PullRequestReviewActivity, "id" | "isResolved">,
  choices: ReadonlyMap<string, boolean>,
): boolean => choices.get(commentChoiceKey(comment)) ?? comment.isResolved !== true;

/** The key of a comment open choice. A new resolution state gives a new key. */
export const commentChoiceKey = (
  comment: Pick<PullRequestReviewActivity, "id" | "isResolved">,
): string => JSON.stringify([comment.id, comment.isResolved]);
