import type {
  PullRequestReviewAggregateStatus,
  PullRequestReviewCheck,
  PullRequestReviewComment,
  PullRequestReviewContext,
} from "@openducktor/contracts";

type LoadedPullRequestReviewContext = Extract<PullRequestReviewContext, { status: "loaded" }>;

export const aggregateBadgeVariant = (
  status: PullRequestReviewAggregateStatus,
): "success" | "danger" | "warning" | "secondary" => {
  if (status === "success") {
    return "success";
  }
  if (status === "failure") {
    return "danger";
  }
  if (status === "pending") {
    return "warning";
  }
  return "secondary";
};

export const aggregateLabel = (status: PullRequestReviewAggregateStatus): string => {
  if (status === "success") {
    return "Passing";
  }
  if (status === "failure") {
    return "Failing";
  }
  if (status === "pending") {
    return "Pending";
  }
  if (status === "neutral") {
    return "Neutral";
  }
  return "Unknown";
};

export const checkBadgeVariant = (
  check: PullRequestReviewCheck,
): "success" | "danger" | "warning" | "secondary" => {
  if (check.status !== "completed") {
    return "warning";
  }
  if (check.conclusion === "success" || check.conclusion === "skipped") {
    return "success";
  }
  if (
    check.conclusion === "failure" ||
    check.conclusion === "cancelled" ||
    check.conclusion === "timed_out" ||
    check.conclusion === "action_required"
  ) {
    return "danger";
  }
  return "secondary";
};

export const checkLabel = (check: PullRequestReviewCheck): string => {
  if (check.status !== "completed") {
    return check.status.replaceAll("_", " ");
  }
  return check.conclusion?.replaceAll("_", " ") ?? "completed";
};

export const isFailingCheck = (check: PullRequestReviewCheck): boolean =>
  check.status === "completed" &&
  (check.conclusion === "failure" ||
    check.conclusion === "cancelled" ||
    check.conclusion === "timed_out" ||
    check.conclusion === "action_required");

export const isPendingCheck = (check: PullRequestReviewCheck): boolean =>
  check.status === "queued" || check.status === "in_progress";

export const isPassingCheck = (check: PullRequestReviewCheck): boolean =>
  check.status === "completed" &&
  (check.conclusion === "success" || check.conclusion === "skipped");

const pluralize = (count: number, singular: string, plural = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : plural}`;

export const checksSummaryLabel = (checks: readonly PullRequestReviewCheck[]): string => {
  if (checks.length === 0) {
    return "No checks";
  }

  const failing = checks.filter(isFailingCheck).length;
  if (failing > 0) {
    return pluralize(failing, "failing");
  }

  const pending = checks.filter(isPendingCheck).length;
  if (pending > 0) {
    return pluralize(pending, "pending");
  }

  const passing = checks.filter(isPassingCheck).length;
  if (passing === checks.length) {
    return pluralize(passing, "passing");
  }

  return pluralize(checks.length, "check");
};

export const providerLabel = (providerId: PullRequestReviewContext["providerId"]): string => {
  if (providerId === "github") {
    return "GitHub";
  }
  return providerId;
};

export const stateLabel = (state: LoadedPullRequestReviewContext["pullRequest"]["state"]): string =>
  state.replaceAll("_", " ");

export const sourceLabel = (source: PullRequestReviewComment["source"]): string => {
  if (source === "review_thread") {
    return "Review thread";
  }
  if (source === "review") {
    return "Review";
  }
  return "Comment";
};

export const isBotCommentAuthor = (author: string | null): boolean => {
  const normalized = author?.trim().toLowerCase() ?? "";
  return (
    normalized.includes("bot") ||
    normalized.includes("code-assist") ||
    normalized.includes("copilot") ||
    normalized.includes("dependabot") ||
    normalized.includes("renovate") ||
    normalized.includes("coderabbit")
  );
};

export const commentLocationLabel = (comment: PullRequestReviewComment): string | null => {
  if (!comment.path) {
    return null;
  }
  return comment.line ? `${comment.path}:${comment.line}` : comment.path;
};
