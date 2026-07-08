import type {
  PullRequestReviewAggregateStatus,
  PullRequestReviewCheck,
  PullRequestReviewComment,
} from "@openducktor/contracts";

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

export const sourceLabel = (source: PullRequestReviewComment["source"]): string => {
  if (source === "review_thread") {
    return "Review thread";
  }
  if (source === "review") {
    return "Review";
  }
  return "Comment";
};

const BOT_LOGIN_SUFFIX = "[bot]";
const AUTOMATION_LOGIN_PATTERNS = [
  /bot$/i,
  /-bot$/i,
  /\bbot\b/i,
  /automation/i,
  /actions/i,
  /renovate/i,
  /dependabot/i,
];

// Some AI/code-review services use regular GitHub users instead of GitHub Apps.
const KNOWN_AUTOMATION_LOGIN_SUBSTRINGS = [
  "chatgpt-codex-connector",
  "code-assist",
  "codex",
  "codex-connector",
  "copilot",
  "qodo",
  "coderabbit",
  "codium",
  "sonarcloud",
  "sonarqube",
  "sourcery-ai",
  "deepsource",
  "snyk",
  "codecov",
  "greptile",
  "ellipsis",
  "graphite-app",
  "reviewer-gpt",
  "-reviewer",
];

export const isBotCommentAuthor = (author: string | null): boolean => {
  const trimmedAuthor = author?.trim() ?? "";
  const normalized = trimmedAuthor.toLowerCase();

  if (normalized.endsWith(BOT_LOGIN_SUFFIX)) {
    return true;
  }
  if (KNOWN_AUTOMATION_LOGIN_SUBSTRINGS.some((needle) => normalized.includes(needle))) {
    return true;
  }
  return AUTOMATION_LOGIN_PATTERNS.some((pattern) => pattern.test(trimmedAuthor));
};

export const commentLocationLabel = (comment: PullRequestReviewComment): string | null => {
  if (!comment.path) {
    return null;
  }
  return comment.line ? `${comment.path}:${comment.line}` : comment.path;
};
