import { describe, expect, test } from "bun:test";
import { NO_CHANGES } from "./replicas/mobile/ChangesScreen";
import { COMMENT_PLACEHOLDER } from "./replicas/mobile/DiffScreen";
import { commentRangeLabel, selectionLabel } from "./replicas/mobile/diff-comment-text";
import { QUEUE_STATUS_LABELS } from "./replicas/mobile/MessageQueue";
import { pendingCommentsText } from "./replicas/mobile/PendingCommentsNotice";
import { COMMENT, HOOK, RANGE, SENT_MESSAGE, TYPED } from "./scenes/mobile-diff-comment/sample";
import { importProduct, readProduct } from "./test-support/product-source";

type ContextLine = { lineNumber: number; text: string; isSelected: boolean };
type Draft = {
  id: string;
  filePath: string;
  diffScope: "target";
  side: "new";
  startLine: number;
  endLine: number;
  text: string;
  codeContext: ContextLine[];
  language: string | null;
};

// SAFETY: diff-comment-model.ts exports this function and imports only types of the app.
const diffCommentModel = await importProduct<{
  selectionLabel: (selection: { side: "new"; startLine: number; endLine: number }) => string;
}>("apps/mobile/src/features/review/diff-comment-model.ts");
// SAFETY: queue-item-state.ts exports this function.
const { buildQueueItemView } = await importProduct<{
  buildQueueItemView: (
    entry: { submissionId: string; state: string; parts: unknown[] },
    options: {
      steerContext: {
        steerBlockedReason: string | null;
        runningTurnModel: null;
        isSessionWorking: boolean;
        foregroundTurnActive: boolean;
        isWaitingInput: boolean;
      };
      actionRuns: boolean;
      commandsOpen: boolean;
    },
  ) => { statusLabel: string };
}>("apps/mobile/src/features/composer/queue-item-state.ts");
// SAFETY: empty-diff-copy.ts exports this function.
const { emptyDiffCopy } = await importProduct<{
  emptyDiffCopy: (input: {
    targetBranch: string;
    isLoading: boolean;
    contextMode: "worktree";
    diffScope: "uncommitted";
    upstreamStatus: undefined;
  }) => { title: string };
}>("packages/frontend-core/src/git/model/empty-diff-copy.ts");
// SAFETY: inline-comment-draft-store.ts exports this function.
const { createInlineCommentDraftStore } = await importProduct<{
  createInlineCommentDraftStore: (options: { storage: Storage }) => {
    getState: () => { formatBatchMessage: (drafts: Draft[]) => string };
    dispose: () => void;
  };
}>("packages/frontend-core/src/drafts/inline-comment-draft-store.ts");
// SAFETY: highlight.ts exports this function.
const { languageForFilePath } = await importProduct<{
  languageForFilePath: (path: string) => string | null;
}>("apps/mobile/src/rich-content/code/highlight.ts");

/** Storage that keeps nothing: the test formats a message and saves no draft. */
const NO_STORAGE: Storage = {
  length: 0,
  clear: () => {},
  key: () => null,
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

describe("the work views of the mobile app copied in the replicas", () => {
  test("the queue cards show the delivery labels of the app", () => {
    for (const [state, label] of Object.entries(QUEUE_STATUS_LABELS)) {
      const view = buildQueueItemView(
        { submissionId: "message", state, parts: [] },
        {
          steerContext: {
            steerBlockedReason: null,
            runningTurnModel: null,
            isSessionWorking: true,
            foregroundTurnActive: true,
            isWaitingInput: false,
          },
          actionRuns: false,
          commandsOpen: true,
        },
      );
      expect(view.statusLabel).toBe(label);
    }
  });

  test("the diff comment flow names the lines as the app does", async () => {
    for (const [start, end] of [
      [9, 9],
      [9, 10],
    ] as const) {
      expect(selectionLabel(start, end)).toBe(
        diffCommentModel.selectionLabel({ side: "new", startLine: start, endLine: end }),
      );
    }
    expect(COMMENT.range).toBe(commentRangeLabel(RANGE.first, RANGE.last));
    expect(pendingCommentsText(1)).toBe("1 pending review comment goes with your next message");
    expect(await readProduct("apps/mobile/src/features/review/diff-comment-flow.tsx")).toContain(
      `"${COMMENT_PLACEHOLDER}"`,
    );
  });

  test("Changes shows the empty state of the app for no uncommitted changes", () => {
    const copy = emptyDiffCopy({
      targetBranch: "main",
      isLoading: false,
      contextMode: "worktree",
      diffScope: "uncommitted",
      upstreamStatus: undefined,
    });
    expect(copy.title).toBe(NO_CHANGES);
  });

  test("the sent message holds the comment as the app formats it", () => {
    const store = createInlineCommentDraftStore({ storage: NO_STORAGE });
    const lines = [RANGE.first, RANGE.last];
    const comment = store.getState().formatBatchMessage([
      {
        id: "comment",
        filePath: HOOK.path,
        diffScope: "target",
        side: "new",
        startLine: RANGE.first,
        endLine: RANGE.last,
        text: COMMENT.text,
        codeContext: lines.map((line) => ({
          lineNumber: line,
          text: HOOK.lines[line - 1] ?? "",
          isSelected: true,
        })),
        language: languageForFilePath(HOOK.path),
      },
    ]);
    store.dispose();
    expect(SENT_MESSAGE).toBe(`${TYPED}\n\n${comment}`);
  });
});
