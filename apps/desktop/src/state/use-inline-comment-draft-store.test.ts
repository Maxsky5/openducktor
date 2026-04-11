import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { useInlineCommentDraftStore } from "./use-inline-comment-draft-store";

const originalDateNow = Date.now;

const resetStore = (): void => {
  useInlineCommentDraftStore.setState({
    drafts: [],
    draftStateKey: null,
  });
};

describe("use-inline-comment-draft-store", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    Date.now = originalDateNow;
    resetStore();
  });

  test("tracks pending and sent comments while keeping per-file counts across both states", () => {
    Date.now = () => 1_700_000_000_000;

    const firstId = useInlineCommentDraftStore.getState().addDraft({
      filePath: "apps/desktop/src/file-a.ts",
      diffScope: "uncommitted",
      startLine: 10,
      endLine: 10,
      side: "new",
      text: "Initial note",
      codeContext: [{ lineNumber: 10, text: "const a = 1;", isSelected: true }],
      language: "ts",
    });
    const secondId = useInlineCommentDraftStore.getState().addDraft({
      filePath: "apps/desktop/src/file-a.ts",
      diffScope: "target",
      startLine: 20,
      endLine: 22,
      side: "old",
      text: "Second note",
      codeContext: [{ lineNumber: 20, text: "old line", isSelected: true }],
      language: "ts",
    });

    const addedState = useInlineCommentDraftStore.getState();
    expect(addedState.getDraftCount()).toBe(2);
    expect(addedState.getFileDraftCount("apps/desktop/src/file-a.ts")).toBe(2);
    expect(
      addedState.getDraftsForFile("apps/desktop/src/file-a.ts").map((draft) => draft.id),
    ).toEqual([secondId, firstId]);

    addedState.updateDraft(firstId, "Updated note");
    expect(
      useInlineCommentDraftStore.getState().drafts.find((draft) => draft.id === firstId)?.text,
    ).toBe("Updated note");
    const pendingSnapshots = useInlineCommentDraftStore
      .getState()
      .getPendingDrafts()
      .map((draft) => ({ id: draft.id, revision: draft.revision }));

    Date.now = () => 1_700_000_000_100;
    useInlineCommentDraftStore.getState().markDraftsAsSent(pendingSnapshots);

    const sentState = useInlineCommentDraftStore.getState();
    expect(sentState.getDraftCount()).toBe(0);
    expect(sentState.getFileDraftCount("apps/desktop/src/file-a.ts")).toBe(2);
    expect(sentState.drafts.every((draft) => draft.status === "sent")).toBe(true);
    expect(sentState.drafts.every((draft) => draft.sentAt === 1_700_000_000_100)).toBe(true);

    sentState.removeDraft(secondId);
    expect(
      useInlineCommentDraftStore.getState().getFileDraftCount("apps/desktop/src/file-a.ts"),
    ).toBe(1);
  });

  test("marks only the submitted snapshot as sent when a pending draft changes in flight", () => {
    Date.now = () => 1_700_000_000_000;

    const firstId = useInlineCommentDraftStore.getState().addDraft({
      filePath: "apps/desktop/src/file-a.ts",
      diffScope: "uncommitted",
      startLine: 10,
      endLine: 10,
      side: "new",
      text: "First note",
      codeContext: [{ lineNumber: 10, text: "first", isSelected: true }],
      language: "ts",
    });
    useInlineCommentDraftStore.getState().addDraft({
      filePath: "apps/desktop/src/file-b.ts",
      diffScope: "target",
      startLine: 20,
      endLine: 20,
      side: "old",
      text: "Second note",
      codeContext: [{ lineNumber: 20, text: "second", isSelected: true }],
      language: "ts",
    });

    const sentSnapshot = useInlineCommentDraftStore
      .getState()
      .getPendingDrafts()
      .map((draft) => ({ id: draft.id, revision: draft.revision }));

    Date.now = () => 1_700_000_000_050;
    useInlineCommentDraftStore
      .getState()
      .updateDraft(firstId, "First note updated after send start");

    Date.now = () => 1_700_000_000_100;
    useInlineCommentDraftStore.getState().markDraftsAsSent(sentSnapshot);

    const drafts = useInlineCommentDraftStore.getState().drafts;
    expect(drafts.find((draft) => draft.id === firstId)?.status).toBe("pending");
    expect(drafts.find((draft) => draft.filePath === "apps/desktop/src/file-b.ts")?.status).toBe(
      "sent",
    );
  });

  test("formats a deterministic pending appendix with scope, side, lines, context, and comment text", () => {
    Date.now = () => 1_700_000_000_000;

    useInlineCommentDraftStore.getState().addDraft({
      filePath: "apps/desktop/src/beta.ts",
      diffScope: "target",
      startLine: 30,
      endLine: 30,
      side: "new",
      text: "Beta line comment",
      codeContext: [
        { lineNumber: 29, text: "before", isSelected: false },
        { lineNumber: 30, text: "selected", isSelected: true },
      ],
      language: "ts",
    });
    useInlineCommentDraftStore.getState().addDraft({
      filePath: "apps/desktop/src/alpha.ts",
      diffScope: "uncommitted",
      startLine: 12,
      endLine: 15,
      side: "old",
      text: "Alpha range comment",
      codeContext: [
        { lineNumber: 12, text: "removed one", isSelected: true },
        { lineNumber: 13, text: "removed two", isSelected: true },
      ],
      language: "ts",
    });

    expect(useInlineCommentDraftStore.getState().formatPendingBatchMessage()).toBe(
      [
        "## Git Diff Comments",
        "",
        "### Comment 1",
        "File: `apps/desktop/src/alpha.ts`",
        "Scope: Uncommitted changes",
        "Side: old",
        "Lines: 12-15",
        "Context:",
        "```ts",
        ">   12 | removed one",
        ">   13 | removed two",
        "```",
        "Comment: Alpha range comment",
        "",
        "### Comment 2",
        "File: `apps/desktop/src/beta.ts`",
        "Scope: Branch changes",
        "Side: new",
        "Lines: 30",
        "Context:",
        "```ts",
        "    29 | before",
        ">   30 | selected",
        "```",
        "Comment: Beta line comment",
      ].join("\n"),
    );
  });

  test("resets comment state only when the draft context key changes", () => {
    const store = useInlineCommentDraftStore.getState();

    store.resetForContext("draft-1");
    store.addDraft({
      filePath: "apps/desktop/src/file-a.ts",
      diffScope: "uncommitted",
      startLine: 3,
      endLine: 3,
      side: "new",
      text: "Note",
      codeContext: [{ lineNumber: 3, text: "line", isSelected: true }],
      language: "ts",
    });

    useInlineCommentDraftStore.getState().resetForContext("draft-1");
    expect(useInlineCommentDraftStore.getState().drafts).toHaveLength(1);

    useInlineCommentDraftStore.getState().resetForContext("draft-2");
    expect(useInlineCommentDraftStore.getState().drafts).toEqual([]);
    expect(useInlineCommentDraftStore.getState().draftStateKey).toBe("draft-2");
  });
});
