import "@openducktor/frontend-core/test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import type { GitFileDiff } from "@openducktor/contracts";
import type { ClientConnection } from "@openducktor/frontend-core/connection/client-connection";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import type { InlineCommentDraft } from "@openducktor/frontend-core/drafts/inline-comment-draft-store";
import { toInlineCommentDraftOwnerKey } from "@openducktor/frontend-core/drafts/inline-comment-draft-store";
import type { InlineCommentOwner } from "@openducktor/frontend-core/drafts/inline-comment-owner";
import type { DiffDataState } from "@openducktor/frontend-core/git/contracts";
import { createEmptyScopeState } from "@openducktor/frontend-core/git/model/scope-state";
import {
  type ClientStorage,
  createMemoryClientStorage,
} from "@openducktor/frontend-core/platform/client-storage";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { act, renderHook } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { buildFileDiffRows, type DiffRow } from "@/rich-content/diff/diff-row-model";
import { changedFileComments } from "./changed-file-comments";
import { changedFileKey } from "./changes-model";
import {
  type CommentFile,
  type DiffCommentFlowState,
  diffCommentFlowReducer,
  type FileLineSelection,
  INITIAL_DIFF_COMMENT_FLOW,
  type NewCommentComposer,
  newCommentComposer,
  newCommentInput,
} from "./diff-comment-flow-model";
import {
  type DiffLineSelection,
  isLineSelected,
  placeDiffComments,
  selectDiffLine,
} from "./diff-comment-model";
import { useOwnerDiffComments, usePendingCommentCount } from "./use-diff-comments";

const PATCH = [
  "--- a/src/parse.ts",
  "+++ b/src/parse.ts",
  "@@ -1,6 +1,7 @@",
  " const a = 1;",
  " const b = 2;",
  "-const c = 3;",
  "+const c = 4;",
  "+const d = 5;",
  " const e = 6;",
  " const f = 7;",
  " const g = 8;",
  "",
].join("\n");

const rows = (): DiffRow[] => {
  const built = buildFileDiffRows(PATCH, "src/parse.ts", { changeType: "modified" });
  if (!built) throw new Error("The test patch must parse.");
  return built;
};

describe("line range selection", () => {
  test("a first tap selects a line and a second tap on its side extends the range", () => {
    const first = selectDiffLine(null, { side: "new", line: 3 });
    expect(first).toEqual({ side: "new", anchor: 3, startLine: 3, endLine: 3 });
    const range = selectDiffLine(first, { side: "new", line: 1 });
    expect(range).toEqual({ side: "new", anchor: 3, startLine: 1, endLine: 3 });
    expect(selectDiffLine(range, { side: "new", line: 5 })).toEqual({
      side: "new",
      anchor: 3,
      startLine: 3,
      endLine: 5,
    });
  });

  test("a tap on the only selected line clears it, and the other side starts again", () => {
    const first = selectDiffLine(null, { side: "new", line: 3 });
    expect(selectDiffLine(first, { side: "new", line: 3 })).toBeNull();
    expect(selectDiffLine(first, { side: "old", line: 3 })).toEqual({
      side: "old",
      anchor: 3,
      startLine: 3,
      endLine: 3,
    });
  });

  test("tells which lines belong to the selection", () => {
    const selection: DiffLineSelection = { side: "new", anchor: 2, startLine: 2, endLine: 4 };
    expect(isLineSelected(selection, { side: "new", line: 3 })).toBe(true);
    expect(isLineSelected(selection, { side: "old", line: 3 })).toBe(false);
    expect(isLineSelected(selection, { side: "new", line: 5 })).toBe(false);
    expect(isLineSelected(null, { side: "new", line: 3 })).toBe(false);
  });
});

const selectionOf = (lines: DiffLineSelection, path = "src/parse.ts"): FileLineSelection => ({
  fileKey: `unstaged:${path}`,
  path,
  diffScope: "uncommitted",
  lines,
});

const composerFor = (lines: DiffLineSelection): NewCommentComposer => {
  const composer = newCommentComposer(selectionOf(lines), rows());
  if (!composer) throw new Error("The test selection must open a composer.");
  return composer;
};

describe("comment input", () => {
  test("captures the selected lines with two lines of context, as desktop does", () => {
    const composer = composerFor({ side: "new", anchor: 3, startLine: 3, endLine: 4 });
    expect(newCommentInput(composer, "  Use a constant.  ", "typescript")).toEqual({
      filePath: "src/parse.ts",
      diffScope: "uncommitted",
      startLine: 3,
      endLine: 4,
      side: "new",
      text: "Use a constant.",
      language: "typescript",
      codeContext: [
        { lineNumber: 1, text: "const a = 1;", isSelected: false },
        { lineNumber: 2, text: "const b = 2;", isSelected: false },
        { lineNumber: 3, text: "const c = 4;", isSelected: true },
        { lineNumber: 4, text: "const d = 5;", isSelected: true },
        { lineNumber: 5, text: "const e = 6;", isSelected: false },
        { lineNumber: 6, text: "const f = 7;", isSelected: false },
      ],
    });
  });

  test("a removed line comments on the old side", () => {
    const composer = composerFor({ side: "old", anchor: 3, startLine: 3, endLine: 3 });
    expect(composer.codeContext.find((line) => line.isSelected)).toEqual({
      lineNumber: 3,
      text: "const c = 3;",
      isSelected: true,
    });
  });

  test("opens no composer when the rows are missing or no longer show the lines", () => {
    const lines: DiffLineSelection = { side: "new", anchor: 40, startLine: 40, endLine: 40 };
    expect(newCommentComposer(selectionOf(lines), rows())).toBeNull();
    expect(
      newCommentComposer(selectionOf({ ...lines, startLine: 3, endLine: 3 }), null),
    ).toBeNull();
  });

  test("saves no comment with empty text", () => {
    const composer = composerFor({ side: "new", anchor: 3, startLine: 3, endLine: 3 });
    expect(newCommentInput(composer, "   ", null)).toBeNull();
  });
});

describe("comment flow", () => {
  const fileA: CommentFile = { fileKey: "a", path: "src/a.ts", diffScope: "uncommitted" };
  const fileB: CommentFile = { fileKey: "b", path: "src/b.ts", diffScope: "uncommitted" };
  const tap = (
    state: DiffCommentFlowState,
    file: CommentFile,
    line: number,
  ): DiffCommentFlowState =>
    diffCommentFlowReducer(state, { type: "line_tapped", file, target: { side: "new", line } });
  const composing = (): DiffCommentFlowState => {
    const selected = tap(INITIAL_DIFF_COMMENT_FLOW, fileA, 3);
    if (!selected.selection) throw new Error("The tap must select a line.");
    const composer = newCommentComposer(selected.selection, rows());
    if (!composer) throw new Error("The selection must open a composer.");
    return diffCommentFlowReducer(selected, { type: "composer_opened", composer });
  };

  test("a line of another file starts a new selection", () => {
    const state = tap(tap(INITIAL_DIFF_COMMENT_FLOW, fileA, 3), fileB, 5);
    expect(state.selection).toMatchObject({ fileKey: "b", lines: { startLine: 5, endLine: 5 } });
  });

  test("line taps keep the lines of a comment that is being written", () => {
    const state = composing();
    expect(tap(state, fileB, 5)).toBe(state);
    // A tap on the only selected line would clear it without the composer.
    expect(tap(state, fileA, 3)).toBe(state);
    const { composer } = state;
    if (composer?.mode !== "new") throw new Error("The composer must be new.");
    expect(newCommentInput(composer, "Check c.", null)).toMatchObject({
      filePath: "src/a.ts",
      startLine: 3,
      codeContext: expect.arrayContaining([
        { lineNumber: 3, text: "const c = 4;", isSelected: true },
      ]),
    });
  });

  test("a hidden diff ends its selection, unless its comment is being written", () => {
    const selected = tap(INITIAL_DIFF_COMMENT_FLOW, fileA, 3);
    expect(diffCommentFlowReducer(selected, { type: "diff_hidden", fileKey: "b" })).toBe(selected);
    expect(
      diffCommentFlowReducer(selected, { type: "diff_hidden", fileKey: "a" }).selection,
    ).toBeNull();
    expect(
      diffCommentFlowReducer(selected, { type: "diff_hidden", fileKey: null }).selection,
    ).toBeNull();
    const state = composing();
    expect(diffCommentFlowReducer(state, { type: "diff_hidden", fileKey: null })).toBe(state);
  });

  test("a saved comment ends the selection, and a closed composer keeps it", () => {
    const state = composing();
    expect(diffCommentFlowReducer(state, { type: "comment_saved" })).toEqual(
      INITIAL_DIFF_COMMENT_FLOW,
    );
    const closed = diffCommentFlowReducer(state, { type: "composer_closed" });
    expect(closed).toEqual({ selection: state.selection, composer: null });
  });
});

const draft = (id: string, overrides: Partial<InlineCommentDraft> = {}): InlineCommentDraft => ({
  id,
  filePath: "src/parse.ts",
  diffScope: "uncommitted",
  startLine: 3,
  endLine: 4,
  side: "new",
  text: "Comment",
  codeContext: [
    { lineNumber: 3, text: "const c = 4;", isSelected: true },
    { lineNumber: 4, text: "const d = 5;", isSelected: true },
  ],
  language: null,
  revision: 1,
  submissionId: null,
  createdAt: 1,
  updatedAt: 1,
  status: "pending",
  ...overrides,
});

describe("comment placement", () => {
  test("places a comment below its last line, and keeps a changed line apart", () => {
    const placed = placeDiffComments(rows(), [
      draft("placed"),
      draft("moved", { codeContext: [{ lineNumber: 3, text: "const c = 9;", isSelected: true }] }),
    ]);
    const keys = placed.rows.map((row) =>
      row.kind === "line" ? `${row.change}:${row.newLine ?? row.oldLine}` : row.kind,
    );
    expect(keys.indexOf("comment")).toBe(keys.indexOf("add:4") + 1);
    expect(placed.unplaced.map((comment) => comment.id)).toEqual(["moved"]);
  });

  test("keeps the parsed rows when no comment is placed", () => {
    const parsed = rows();
    expect(placeDiffComments(parsed, []).rows).toEqual(parsed);
  });
});

const fileDiff = (diff: string): GitFileDiff => ({
  file: "src/parse.ts",
  type: "modified",
  additions: 2,
  deletions: 1,
  diff,
});

const SNAPSHOT = { hashVersion: 2, statusHash: "0000000000000001", diffHash: "0000000000000002" };

/** The Git reads of a partly staged `src/parse.ts`: PATCH is unstaged, `staged` is staged. */
const partlyStaged = (staged: string): DiffDataState => ({
  repoPath: "/repo",
  branch: "feature",
  worktreePath: "/repo",
  targetBranch: "origin/main",
  comparisonReference: "refs/remotes/origin/main",
  comparisonPending: false,
  comparisonUnavailableReason: null,
  gitConflict: null,
  scopeStatesByScope: {
    uncommitted: {
      ...createEmptyScopeState(),
      localChanges: {
        currentBranch: { name: "feature", detached: false },
        fileStatuses: [],
        unstaged: { fileStatuses: [], fileDiffs: [fileDiff(PATCH)], snapshot: SNAPSHOT },
        staged: { fileStatuses: [], fileDiffs: [fileDiff(staged)], snapshot: SNAPSHOT },
        conflicted: { fileStatuses: [], fileDiffs: [] },
        upstreamAheadBehind: { outcome: "tracking", ahead: 0, behind: 0 },
        snapshot: {
          effectiveWorkingDir: "/repo",
          targetBranch: "HEAD",
          diffScope: "uncommitted",
          observedAtMs: 1,
          ...SNAPSHOT,
        },
      },
      uncommittedFileCount: 1,
    },
    target: { ...createEmptyScopeState(), fileDiffs: [fileDiff(PATCH)] },
  },
  loadedScopesByScope: { uncommitted: true, target: true },
  commitsAheadBehind: null,
  upstreamAheadBehind: null,
  upstreamStatus: "tracking",
  fileStatuses: [],
  hashVersion: null,
  statusHash: null,
  diffHash: null,
  uncommittedFileCount: 1,
  isLoading: false,
});

const STAGED_PATCH = PATCH.replace("+const c = 4;", "+const c = 9;");
const UNSTAGED_KEY = changedFileKey("unstaged", "src/parse.ts");
const STAGED_KEY = changedFileKey("staged", "src/parse.ts");

describe("changed file comments", () => {
  test("a partly staged file shows each comment once, in the group that holds its lines", () => {
    const byFile = changedFileComments(partlyStaged(STAGED_PATCH), [
      draft("unstaged-line"),
      draft("staged-line", {
        startLine: 3,
        endLine: 3,
        codeContext: [{ lineNumber: 3, text: "const c = 9;", isSelected: true }],
      }),
    ]);
    expect(byFile.get(UNSTAGED_KEY)?.map((comment) => comment.id)).toEqual(["unstaged-line"]);
    expect(byFile.get(STAGED_KEY)?.map((comment) => comment.id)).toEqual(["staged-line"]);
  });

  test("Branch changes comments stay with the target file", () => {
    const byFile = changedFileComments(partlyStaged(STAGED_PATCH), [
      draft("target", { diffScope: "target" }),
    ]);
    expect(byFile.get(changedFileKey("target", "src/parse.ts"))?.map((c) => c.id)).toEqual([
      "target",
    ]);
    expect(byFile.has(UNSTAGED_KEY)).toBe(false);
  });
});

describe("comment draft actions", () => {
  const owner: InlineCommentOwner = { kind: "task", workspaceId: "ws-1", taskId: "task-1" };
  const diffData = partlyStaged(STAGED_PATCH);

  const render = (connection: ClientConnection) =>
    renderHook(
      () => ({
        comments: useOwnerDiffComments(owner, diffData),
        pending: usePendingCommentCount(owner),
      }),
      {
        wrapper: ({ children }: PropsWithChildren) =>
          createElement(ClientConnectionProvider, { connection }, children),
      },
    );

  const connectionWith = (storage: ClientStorage) =>
    createTestClientConnection({ storage, scheduleTask: () => () => {} });

  const inputFor = (line: number, text: string) => {
    const composer = composerFor({ side: "new", anchor: line, startLine: line, endLine: line });
    const input = newCommentInput(composer, text, null);
    if (!input) throw new Error("The test selection must build a comment.");
    return input;
  };

  test("adds, edits, and removes pending comments in the drafts of the host connection", () => {
    const connection = connectionWith(createMemoryClientStorage());
    const view = render(connection);
    act(() => view.result.current.comments.addComment(inputFor(3, "Use a constant.")));
    expect(view.result.current.pending).toBe(1);
    const fileComments = () => view.result.current.comments.commentsByFile.get(UNSTAGED_KEY) ?? [];
    const [added] = fileComments();
    expect(added?.text).toBe("Use a constant.");
    if (!added) throw new Error("The comment must exist.");
    expect(view.result.current.comments.commentsById.get(added.id)).toBe(added);
    // The Staged diff changed line 3, so only the Unstaged row shows the comment.
    expect(view.result.current.comments.commentsByFile.has(STAGED_KEY)).toBe(false);

    act(() => view.result.current.comments.updateComment(added.id, "Use a named constant."));
    expect(fileComments()[0]?.text).toBe("Use a named constant.");
    const ownerKey = toInlineCommentDraftOwnerKey(owner) ?? "";
    expect(
      connection.drafts.inlineComments.getState().formatPendingBatchMessage(ownerKey),
    ).toContain("Use a named constant.");

    act(() => view.result.current.comments.removeComment(added.id));
    expect(fileComments()).toEqual([]);
    expect(view.result.current.pending).toBe(0);
    view.unmount();
  });

  test("keeps pending comments on the device for the same host only", () => {
    const storage = createMemoryClientStorage();
    const first = connectionWith(storage);
    const view = render(first);
    act(() => view.result.current.comments.addComment(inputFor(4, "Check d.")));
    first.drafts.inlineComments.getState().flush();
    view.unmount();

    const ownerKey = toInlineCommentDraftOwnerKey(owner) ?? "";
    const reopened = connectionWith(storage);
    reopened.drafts.inlineComments.getState().hydrate(ownerKey);
    const reopenedView = render(reopened);
    expect(
      reopenedView.result.current.comments.commentsByFile
        .get(UNSTAGED_KEY)
        ?.map((comment) => comment.text),
    ).toEqual(["Check d."]);
    reopenedView.unmount();

    const otherHost = connectionWith(createMemoryClientStorage());
    otherHost.drafts.inlineComments.getState().hydrate(ownerKey);
    const otherView = render(otherHost);
    expect(otherView.result.current.comments.commentsById.size).toBe(0);
    otherView.unmount();
  });
});
