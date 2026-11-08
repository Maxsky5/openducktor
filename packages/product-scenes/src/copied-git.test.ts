import { describe, expect, test } from "bun:test";
import { CHECKS_TEXT } from "./replicas/studio/ChecksPanel";
import { CONFLICT_TEXT } from "./replicas/studio/GitConflict";
import { GIT_HEADER_TEXT, TARGET_BRANCH } from "./replicas/studio/GitHeader";
import { type CheckState, checksStatus, checksSummary } from "./replicas/studio/model";
import {
  type CiComment,
  COMMENT_FILTERS,
  commentAge,
  type CommentCounts,
  commentCounts,
  commentLocation,
  REVIEW_OUTCOMES,
} from "./replicas/studio/comments";
import { READS } from "./scenes/ci-checks/sample";
import { CONFLICT_INSTRUCTIONS, COUNTS, REBASE_TIP } from "./scenes/git-conflict/sample";
import {
  APPROVAL,
  COMMENTS,
  NOW,
  SUGGESTION,
  THREAD_HUNK,
  THREAD_SOURCE,
} from "./scenes/pr-comments/sample";
import { importProduct } from "./test-support/product-source";

/** The fields of PullRequestReviewActivity that the comments list reads. */
type Activity = {
  id: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  path: string | null;
  line: number | null;
  isResolved: boolean | null;
  source: CiComment["source"];
};
type Check = { status: "completed" | "in_progress"; conclusion: "success" | "failure" | null };
type Status = "success" | "failure" | "pending";
type HeaderInput = {
  branch: string;
  branchKnown: boolean;
  commitsAheadBehind: { ahead: number; behind: number };
  contextMode: "worktree";
  targetBranch: string;
  targetBranchOptions: readonly string[];
  uncommittedFileCount: number;
  isLoading: boolean;
  isRefreshing: boolean;
};
type ActionsInput = {
  operation: "rebase";
  isHandlingConflict: boolean;
  conflictAction: undefined;
  onAbort: () => void;
  onAsk: () => void;
};

// SAFETY: task-execution-ci-presentation.ts exports these functions, and a missing export fails
// the test.
const ci = await importProduct<{
  aggregateLabel: (status: Status) => string;
  checkLabel: (check: Check) => string;
  checksSummaryLabel: (checks: readonly Check[]) => string;
  REVIEW_OUTCOME_PRESENTATION: Record<string, { label: string; variant: string }>;
  commentLocationLabel: (comment: Activity) => string | null;
  isBotComment: (comment: Activity) => boolean;
}>("packages/frontend-core/src/review/task-execution-ci-presentation.ts");
// SAFETY: pull-request-comment-filters.ts exports the filters and their counts, and a missing
// export fails the test.
const filters = await importProduct<{
  PULL_REQUEST_COMMENT_FILTERS: readonly { id: string; label: string }[];
  countPullRequestComments: (comments: readonly Activity[], hideResolved: boolean) => CommentCounts;
  filterPullRequestComments: (
    comments: readonly Activity[],
    filter: string,
    hideResolved: boolean,
  ) => Activity[];
}>("packages/frontend-core/src/review/pull-request-comment-filters.ts");
// SAFETY: task-execution-ci-relative-time-format.ts exports this function, and a missing export
// fails the test.
const { formatCiRelativeTime } = await importProduct<{
  formatCiRelativeTime: (timestamp: string, now: number) => string;
}>("packages/frontend-core/src/review/task-execution-ci-relative-time-format.ts");
// SAFETY: suggestions.ts exports the parser of a GitHub review comment, and a missing export fails
// the test.
const { parseGithubReviewCommentContent } = await importProduct<{
  parseGithubReviewCommentContent: (input: {
    body: string;
    diffHunk: string | null;
    lineRanges: { startLine: number; endLine: number }[];
  }) => { body: string; suggestionPatches: string[]; suggestionWarning: string | null };
}>("packages/host/src/adapters/git-providers/github/review/suggestions.ts");
// SAFETY: panel-tab-kinds.ts exports the tab rules, and a missing export fails the test.
const { PANEL_TAB_KIND_RULES } = await importProduct<{
  PANEL_TAB_KIND_RULES: Record<string, { label: string }>;
}>("packages/frontend/src/features/session-panels/panel-tab-kinds.ts");
// SAFETY: constants.ts exports the views of the Git panel, and a missing export fails the test.
const { GIT_PANEL_TABS } = await importProduct<{ GIT_PANEL_TABS: readonly { label: string }[] }>(
  "packages/frontend/src/components/features/agents/agent-studio-git-panel/constants.ts",
);
// SAFETY: git-info-header-state.ts exports this function, and a missing export fails the test.
const { getGitInfoHeaderState } = await importProduct<{
  getGitInfoHeaderState: (props: HeaderInput) => { rebaseTooltip: string };
}>(
  "packages/frontend/src/components/features/agents/agent-studio-git-panel/git-info-header-state.ts",
);
// SAFETY: conflict-copy.ts exports this function, and a missing export fails the test.
const { getGitConflictCopy } = await importProduct<{
  getGitConflictCopy: (operation: "rebase") => Record<string, string>;
}>("packages/frontend-core/src/git/conflicts/conflict-copy.ts");
// SAFETY: git-conflict-actions-model.ts exports this function, and a missing export fails the test.
const { createGitConflictActionsModel } = await importProduct<{
  createGitConflictActionsModel: (input: ActionsInput) => { help?: { label: string } };
}>("packages/frontend-core/src/git/conflicts/git-conflict-actions-model.ts");
// SAFETY: prompt-templates.ts exports the conflict instructions of the Builder.
const { GIT_CONFLICT_INSTRUCTIONS } = await importProduct<{ GIT_CONFLICT_INSTRUCTIONS: string }>(
  "packages/workflows/src/builtin/spec-plan-build/prompt-templates.ts",
);

const CHECKS = {
  success: { status: "completed", conclusion: "success" },
  failure: { status: "completed", conclusion: "failure" },
  pending: { status: "in_progress", conclusion: null },
} as const satisfies Record<CheckState, Check>;

/** The words of the replicas as plain strings, so each one compares with a string of the app. */
const CI_TEXT: Readonly<Record<string, string>> = CHECKS_TEXT;
const GIT_TEXT: Readonly<Record<string, string>> = CONFLICT_TEXT;

const STATUS = { passing: "success", failing: "failure", pending: "pending" } as const;

describe("the CI Checks tab copied from the app", () => {
  test("each read shows the summary and the badge of the app", () => {
    for (const { states } of Object.values(READS)) {
      const shown = Object.values(states);
      expect(checksSummary(shown)).toBe(ci.checksSummaryLabel(shown.map((state) => CHECKS[state])));
      expect(CI_TEXT[checksStatus(shown)]).toBe(ci.aggregateLabel(STATUS[checksStatus(shown)]));
    }
  });

  test("the check rows use the state labels and the tab label of the app", () => {
    expect(CI_TEXT.success).toBe(ci.checkLabel(CHECKS.success));
    expect(CI_TEXT.failure).toBe(ci.checkLabel(CHECKS.failure));
    expect(CI_TEXT.inProgress).toBe(ci.checkLabel(CHECKS.pending));
    expect(PANEL_TAB_KIND_RULES.ci_checks?.label).toBe("CI Checks");
  });
});

describe("the Git header and conflict copied from the app", () => {
  test("the header uses the views and the rebase tooltip of the app", () => {
    expect<readonly string[]>(GIT_HEADER_TEXT.tabs).toEqual(GIT_PANEL_TABS.map((tab) => tab.label));
    const state = getGitInfoHeaderState({
      branch: "odt/task",
      branchKnown: true,
      commitsAheadBehind: { ahead: COUNTS.before.ahead, behind: COUNTS.before.behind },
      contextMode: "worktree",
      targetBranch: TARGET_BRANCH,
      targetBranchOptions: [],
      uncommittedFileCount: 0,
      isLoading: false,
      isRefreshing: false,
    });
    // git-info-header.tsx adds the comparison branch to the tooltip of the state.
    expect(REBASE_TIP).toBe(`${state.rebaseTooltip}: ${TARGET_BRANCH}`);
  });

  test("the conflict uses the words of the app and the instructions of the Builder", () => {
    const copy = getGitConflictCopy("rebase");
    expect(GIT_TEXT.title).toBe(copy.title ?? "");
    expect(GIT_TEXT.inProgress).toBe(copy.inProgressLabel ?? "");
    expect(GIT_TEXT.operation).toBe(copy.operationLabel ?? "");
    expect(GIT_TEXT.abort).toBe(copy.abortLabel ?? "");
    const actions = createGitConflictActionsModel({
      operation: "rebase",
      isHandlingConflict: false,
      conflictAction: undefined,
      onAbort: () => {},
      onAsk: () => {},
    });
    expect(GIT_TEXT.resolve).toBe(actions.help?.label ?? "");
    expect(CONFLICT_INSTRUCTIONS).toBe(GIT_CONFLICT_INSTRUCTIONS);
  });
});

/** The activity of the host for a comment of the scene. GitHub sends no bot flag, so the name
 * of the author decides. */
function activity(comment: CiComment): Activity {
  return {
    id: comment.id,
    author: comment.author,
    createdAt: comment.createdAt,
    updatedAt: comment.createdAt,
    path: comment.path ?? null,
    line: comment.line ?? null,
    isResolved: comment.resolved,
    source: comment.source,
  };
}

describe("the comments of the CI Checks tab copied from the app", () => {
  const first = COMMENTS.filter((comment) => comment.id !== APPROVAL);
  const reads = [
    { comments: first, now: NOW.first },
    { comments: COMMENTS, now: NOW.last },
  ];

  test("the filters, the counts, and the order follow the app", () => {
    expect<readonly { id: string; label: string }[]>(COMMENT_FILTERS).toEqual(
      filters.PULL_REQUEST_COMMENT_FILTERS,
    );
    for (const { comments } of reads) {
      for (const hideResolved of [false, true]) {
        expect(commentCounts(comments, hideResolved)).toEqual(
          filters.countPullRequestComments(comments.map(activity), hideResolved),
        );
      }
      const ordered = filters.filterPullRequestComments(comments.map(activity), "all", false);
      expect(ordered.map((item) => item.id)).toEqual(comments.map((comment) => comment.id));
    }
  });

  test("each card shows the badges, the place, and the time of the app", () => {
    expect<Readonly<Record<string, { label: string; variant: string }>>>(REVIEW_OUTCOMES).toEqual(
      ci.REVIEW_OUTCOME_PRESENTATION,
    );
    for (const { comments, now } of reads) {
      for (const comment of comments) {
        expect(comment.bot).toBe(ci.isBotComment(activity(comment)));
        expect(commentLocation(comment)).toBe(ci.commentLocationLabel(activity(comment)));
        expect(commentAge(comment.createdAt, now)).toBe(
          formatCiRelativeTime(comment.createdAt, Date.parse(now)),
        );
      }
    }
  });

  test("the thread holds the body and the suggestion that the host reads from GitHub", () => {
    const content = parseGithubReviewCommentContent({
      body: THREAD_SOURCE.body,
      diffHunk: THREAD_HUNK,
      lineRanges: [{ startLine: THREAD_SOURCE.line, endLine: THREAD_SOURCE.line }],
    });
    const thread = COMMENTS.find((comment) => comment.suggestions);
    expect(content).toEqual({
      body: thread?.body ?? "",
      suggestionPatches: [SUGGESTION],
      suggestionWarning: null,
    });
  });
});
