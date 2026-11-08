// The data of the comments of the CI Checks tab: the review activity of a pull request, as
// PullRequestReviewActivity of packages/contracts has it, the author filters, and the relative
// times. Sources: pull-request-comment-filters.ts, task-execution-ci-presentation.ts, and
// task-execution-ci-relative-time-format.ts in packages/frontend-core/src/review.

/** The outcome of a review, from pullRequestReviewOutcomeSchema. */
export type ReviewOutcome = "approved" | "changes_requested" | "commented" | "dismissed";

/** The badge of a review outcome, from REVIEW_OUTCOME_PRESENTATION. */
export const REVIEW_OUTCOMES = {
  approved: { label: "Approved", variant: "success" },
  changes_requested: { label: "Changes requested", variant: "danger" },
  commented: { label: "Commented", variant: "secondary" },
  dismissed: { label: "Review dismissed", variant: "outline" },
} as const satisfies Record<ReviewOutcome, { label: string; variant: string }>;

/**
 * One item of the comments list: a comment of the pull request, a review, or a comment of a review
 * thread. The body is Markdown with inline code only. The patches are unified diffs.
 */
export type CiComment = {
  id: string;
  source: "comment" | "review" | "review_thread";
  author: string;
  /** The provider marks the author as a bot. */
  bot: boolean;
  outcome?: ReviewOutcome;
  createdAt: string;
  body: string;
  /** The diff hunk of a review thread, up to the line of the comment. */
  patch?: string;
  suggestions?: readonly string[];
  path?: string;
  line?: number;
  /** A review thread is resolved or not. Other items have no resolution. */
  resolved: boolean | null;
};

/** The author filters of PULL_REQUEST_COMMENT_FILTERS. */
export const COMMENT_FILTERS = [
  { id: "all", label: "All" },
  { id: "humans", label: "Humans" },
  { id: "bots", label: "Bots" },
] as const;
export type CommentFilter = (typeof COMMENT_FILTERS)[number]["id"];

/** The words of the comments list and of a comment card. */
export const COMMENTS_TEXT = {
  title: "Comments",
  filter: "Filter comments",
  hideResolved: "Hide resolved",
  bot: "Bot",
  resolved: "Resolved",
  unresolved: "Unresolved",
  suggestion: "Suggested change",
} as const;

export type CommentCounts = { all: number; humans: number; bots: number };

/** The count of each filter, as countPullRequestComments gives it. */
export function commentCounts(
  comments: readonly Pick<CiComment, "bot" | "resolved">[],
  hideResolved: boolean,
): CommentCounts {
  const countable = comments.filter((comment) => !(hideResolved && comment.resolved === true));
  const bots = countable.filter((comment) => comment.bot).length;
  return { all: countable.length, humans: countable.length - bots, bots };
}

/** The place of a comment in the code, as commentLocationLabel gives it. */
export function commentLocation(comment: Pick<CiComment, "path" | "line">): string | null {
  if (!comment.path) return null;
  return comment.line ? `${comment.path}:${comment.line}` : comment.path;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The relative time of formatCiRelativeTime for the times of a scene, which are all today. */
export function commentAge(createdAt: string, now: string): string {
  const elapsed = Math.max(0, Date.parse(now) - Date.parse(createdAt));
  if (elapsed < MINUTE) return "now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  return `${Math.floor(elapsed / HOUR)}h ago`;
}

/** One line of a unified diff, with the line number that the unified view of @pierre/diffs shows. */
export type PatchLine = { kind: "add" | "del" | "ctx"; number: number; text: string };

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** The lines of a unified diff. A deleted line shows its old number, another its new number. */
export function patchLines(patch: string): PatchLine[] {
  const lines: PatchLine[] = [];
  let before = 0;
  let after = 0;
  for (const line of patch.split("\n")) {
    const header = HUNK_HEADER.exec(line);
    if (header) {
      before = Number(header[1]);
      after = Number(header[2]);
      continue;
    }
    const text = line.slice(1);
    if (line.startsWith("-")) lines.push({ kind: "del", number: before++, text });
    else if (line.startsWith("+")) lines.push({ kind: "add", number: after++, text });
    else {
      lines.push({ kind: "ctx", number: after, text });
      before += 1;
      after += 1;
    }
  }
  return lines;
}
