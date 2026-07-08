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
