import { describe, expect, test } from "bun:test";
import { NO_CHANGES, SCOPE_TABS } from "./replicas/mobile/ChangesScreen";
import { COMMENT_PLACEHOLDER } from "./replicas/mobile/DiffScreen";
import { commentRangeLabel, selectionLabel } from "./replicas/mobile/diff-comment-text";
import { QUEUE_STATUS_LABELS } from "./replicas/mobile/MessageQueue";
import { pendingCommentsText } from "./replicas/mobile/PendingCommentsNotice";
import {
  COMMENT,
  HOOK,
  RANGE,
  SENT_MESSAGE,
  SESSION_ACTIONS,
  TYPED,
} from "./scenes/mobile-diff-comment/sample";
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
// SAFETY: changes-model.ts exports these options.
const { CHANGES_SCOPE_OPTIONS } = await importProduct<{
  CHANGES_SCOPE_OPTIONS: readonly { value: string; label: string }[];
}>("apps/mobile/src/features/review/changes-model.ts");
// SAFETY: work-view-links.ts exports this function, and its routes import only types.
const { buildWorkViewLinks } = await importProduct<{
  buildWorkViewLinks: (owner: { workspaceId: string; taskId: string }) => {
    key: string;
    label: string;
    icon: string;
  }[];
}>("apps/mobile/src/features/session/header/work-view-links.ts");
// SAFETY: icon-names.ts exports this map of app icons to Lucide names.
const { ICONS } = await importProduct<{ ICONS: Record<string, string> }>(
  "apps/mobile/src/ui/icon-names.ts",
);

/** The component name of a Lucide icon, such as FileDiff for file-diff. */
const lucideComponent = (name: string): string =>
  name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

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

  test("the session menu of a task session lists the work views of the app", () => {
    const links = buildWorkViewLinks({ workspaceId: "workspace", taskId: "task" });
    // Task Details and Copy Task ID come first, as session-header.tsx adds them.
    const views = SESSION_ACTIONS.slice(2);
    expect(views.map(({ id, title }) => [id, title])).toEqual(
      links.map(({ key, label }) => [key, label]),
    );
    // An app icon without a Lucide name gives undefined, so the test fails on it.
    const names = links.map(({ icon }) => ICONS[icon]);
    expect(views.map(({ icon }) => icon.displayName)).toEqual(
      names.map((name) => name && lucideComponent(name)),
    );
  });

  test("Changes shows the scope tabs of the app", () => {
    const tabs: readonly { value: string; label: string }[] = SCOPE_TABS;
    expect(tabs).toEqual(CHANGES_SCOPE_OPTIONS);
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
