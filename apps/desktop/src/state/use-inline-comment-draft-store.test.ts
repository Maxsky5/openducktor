import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { useInlineCommentDraftStore } from "./use-inline-comment-draft-store";

const originalDateNow = Date.now;

const resetStore = (): void => {
  useInlineCommentDraftStore.setState({
    drafts: [],
    editingDraftId: null,
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

  test("adds, updates, removes, and clears drafts while keeping editing state in sync", () => {
    Date.now = () => 1_700_000_000_000;

    const firstId = useInlineCommentDraftStore.getState().addDraft({
      filePath: "apps/desktop/src/file-a.ts",
      startLine: 10,
      endLine: 10,
      side: "modified",
      text: "Initial note",
    });
    const secondId = useInlineCommentDraftStore.getState().addDraft({
      filePath: "apps/desktop/src/file-b.ts",
      startLine: 20,
      endLine: 22,
      side: "original",
      text: "Second note",
    });

    const addedState = useInlineCommentDraftStore.getState();
    expect(addedState.getDraftCount()).toBe(2);
    expect(addedState.drafts.map((draft) => draft.id)).toEqual([firstId, secondId]);
    expect(addedState.drafts.map((draft) => draft.createdAt)).toEqual([
      1_700_000_000_000, 1_700_000_000_000,
    ]);

    addedState.setEditing(secondId);
    addedState.updateDraft(firstId, "Updated note");

    const updatedState = useInlineCommentDraftStore.getState();
    expect(updatedState.editingDraftId).toBe(secondId);
    expect(updatedState.drafts.find((draft) => draft.id === firstId)?.text).toBe("Updated note");

    updatedState.removeDraft(secondId);

    const removedState = useInlineCommentDraftStore.getState();
    expect(removedState.getDraftCount()).toBe(1);
    expect(removedState.editingDraftId).toBeNull();
    expect(removedState.drafts.map((draft) => draft.id)).toEqual([firstId]);

    removedState.clearAll();

    const clearedState = useInlineCommentDraftStore.getState();
    expect(clearedState.getDraftCount()).toBe(0);
    expect(clearedState.drafts).toEqual([]);
    expect(clearedState.editingDraftId).toBeNull();
  });

  test("formats grouped markdown by file with sorted line ranges and original-side labels", () => {
    Date.now = () => 1_700_000_000_000;

    const store = useInlineCommentDraftStore.getState();
    store.addDraft({
      filePath: "apps/desktop/src/beta.ts",
      startLine: 30,
      endLine: 30,
      side: "modified",
      text: "Beta line comment",
    });
    store.addDraft({
      filePath: "apps/desktop/src/alpha.ts",
      startLine: 12,
      endLine: 15,
      side: "original",
      text: "Alpha range comment",
    });
    store.addDraft({
      filePath: "apps/desktop/src/alpha.ts",
      startLine: 5,
      endLine: 5,
      side: "modified",
      text: "Alpha single-line comment",
    });

    expect(useInlineCommentDraftStore.getState().formatBatchMessage()).toBe(
      [
        "## Review Comments",
        "",
        "### `apps/desktop/src/beta.ts` (line 30)",
        "Beta line comment",
        "",
        "### `apps/desktop/src/alpha.ts` (line 5)",
        "Alpha single-line comment",
        "",
        "### `apps/desktop/src/alpha.ts` (lines 12-15 (old))",
        "Alpha range comment",
        "",
      ].join("\n"),
    );
  });
});
