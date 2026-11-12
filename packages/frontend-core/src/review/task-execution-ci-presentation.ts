import type {
  PullRequestReviewActivity,
  PullRequestReviewAggregateStatus,
  PullRequestReviewCheck,
  PullRequestReviewCheckConclusion,
  PullRequestReviewOutcome,
} from "@openducktor/contracts";

type ReviewOutcomePresentation = {
  label: string;
  variant: "success" | "danger" | "secondary" | "outline";
};

export const REVIEW_OUTCOME_PRESENTATION = {
  approved: { label: "Approved", variant: "success" },
  changes_requested: { label: "Changes requested", variant: "danger" },
  commented: { label: "Commented", variant: "secondary" },
  dismissed: { label: "Review dismissed", variant: "outline" },
} satisfies Record<PullRequestReviewOutcome, ReviewOutcomePresentation>;

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
): "success" | "danger" | "warning" | "info" | "secondary" => {
  if (isPendingCheck(check)) {
    return "info";
  }
  if (isPassingCheck(check)) {
    return "success";
  }
  if (isFailingCheck(check)) {
    return "danger";
  }
  if (isWarningCheck(check)) {
    return "warning";
  }
  return "secondary";
};

const CHECK_CONCLUSION_LABELS = {
  success: "Success",
  failure: "Failure",
  cancelled: "Cancelled",
  skipped: "Skipped",
  timed_out: "Timed out",
  action_required: "Action required",
  neutral: "Neutral",
  warning: "Warning",
  unknown: "Unknown",
} as const satisfies Record<PullRequestReviewCheckConclusion, string>;

export const checkLabel = (check: PullRequestReviewCheck): string => {
  if (check.status !== "completed") {
    return check.status.replaceAll("_", " ");
  }
  return check.conclusion ? CHECK_CONCLUSION_LABELS[check.conclusion] : "completed";
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

/** A failed check that does not block the pull request. It is neither failing nor passing. */
export const isWarningCheck = (check: PullRequestReviewCheck): boolean =>
  check.status === "completed" && check.conclusion === "warning";

const pluralize = (count: number, singular: string, plural = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : plural}`;

export const checksSummaryLabel = (checks: readonly PullRequestReviewCheck[]): string => {
  if (checks.length === 0) {
    return "No checks";
  }

  const failing = checks.filter(isFailingCheck).length;
  if (failing > 0) {
    return `${failing} failing`;
  }

  const pending = checks.filter(isPendingCheck).length;
  if (pending > 0) {
    return `${pending} pending`;
  }

  const passing = checks.filter(isPassingCheck).length;
  if (passing === checks.length) {
    return `${passing} passing`;
  }

  return pluralize(checks.length, "check");
};

export type CiChecksIndicatorStatus = "failure" | "pending" | "success";

export const ciChecksIndicatorStatus = (
  checks: readonly PullRequestReviewCheck[],
): CiChecksIndicatorStatus | null => {
  if (checks.some(isFailingCheck)) {
    return "failure";
  }
  if (checks.some(isPendingCheck)) {
    return "pending";
  }
  if (checks.length > 0 && checks.every(isPassingCheck)) {
    return "success";
  }
  return null;
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
  // GitLab project, group, and service account bot users.
  /^project_\d+_bot_[a-f\d]+$/i,
  /^group_\d+_bot_[a-f\d]+$/i,
  /^service_account_/i,
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

/** The provider's bot flag decides when it sends one. Otherwise the author name decides. */
export const isBotComment = (
  comment: Pick<PullRequestReviewActivity, "author" | "authorIsBot">,
): boolean => comment.authorIsBot ?? isBotCommentAuthor(comment.author);

export const commentLocationLabel = (comment: PullRequestReviewActivity): string | null => {
  if (!comment.path) {
    return null;
  }
  return comment.line ? `${comment.path}:${comment.line}` : comment.path;
};
