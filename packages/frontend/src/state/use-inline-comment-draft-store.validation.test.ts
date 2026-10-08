import { afterEach, expect, test } from "bun:test";
import { readInlineCommentDraftsFromStorage } from "./inline-comment-draft-storage";
import {
  resetInlineCommentDraftStoreForTests,
  setInlineCommentDraftScheduleTaskForTests,
  setInlineCommentDraftStorageForTests,
  toInlineCommentDraftOwnerKey,
  useInlineCommentDraftStore,
} from "./use-inline-comment-draft-store";
import type { InlineCommentOwner } from "@/types/inline-comment-owner";

afterEach(resetInlineCommentDraftStoreForTests);

for (const owner of [
  { kind: "task", workspaceId: "workspace-1", taskId: "same-id" },
  { kind: "workspace_session", workspaceId: "workspace-1", sessionId: "same-id" },
] satisfies InlineCommentOwner[]) {
  test.each(["accepted", "rejected"] as const)(
    `${owner.kind} drops missing drafts when Send returns %s and keeps later drafts`,
    (outcome) => {
      resetInlineCommentDraftStoreForTests();
      const values = new Map<string, string>();
      const storage = {
        get length() {
          return values.size;
        },
        key: (index: number) => Array.from(values.keys())[index] ?? null,
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
        removeItem: (key: string) => {
          values.delete(key);
        },
      };
      const ownerKey = toInlineCommentDraftOwnerKey(owner);
      const otherOwnerKey = toInlineCommentDraftOwnerKey({ ...owner, workspaceId: "workspace-2" });
      if (ownerKey === null || otherOwnerKey === null) throw new Error("Expected comment owners.");
      const setStorage = () => {
        setInlineCommentDraftStorageForTests(storage);
        setInlineCommentDraftScheduleTaskForTests(() => () => {});
      };
      setStorage();
      const add = (key: string, filePath: string) =>
        useInlineCommentDraftStore.getState().addDraft(key, {
          filePath,
          diffScope: "uncommitted",
          startLine: 1,
          endLine: 1,
          side: "new",
          text: filePath,
          codeContext: [],
        });
      const missingId = add(ownerKey, "src/missing.ts");
      const validId = add(ownerKey, "src/present.ts");
      add(otherOwnerKey, "src/missing.ts");
      useInlineCommentDraftStore.getState().flush();
      resetInlineCommentDraftStoreForTests();
      setStorage();
      const store = useInlineCommentDraftStore.getState();
      store.hydrate(ownerKey);
      store.hydrate(otherOwnerKey);
      const submissionId = store.beginSubmittingDrafts(ownerKey, store.getPendingDrafts(ownerKey));
      if (submissionId === null) throw new Error("Expected a submitting batch.");

      store.dropDraftsForMissingFiles(ownerKey, "uncommitted", new Set(["src/present.ts"]));
      expect(useInlineCommentDraftStore.getState().draftsByOwner[ownerKey]).toEqual([
        expect.objectContaining({ id: missingId, status: "submitting", submissionId }),
        expect.objectContaining({ id: validId, status: "submitting", submissionId }),
      ]);
      expect(() => store.removeDraft(ownerKey, missingId)).toThrow("while it is being sent");
      const laterId = add(ownerKey, "src/missing.ts");
      store.updateDraft(ownerKey, laterId, "Newer edit");
      store.dropDraftsForMissingFiles(ownerKey, "uncommitted", new Set());

      const settle =
        outcome === "accepted" ? store.completeSubmittingDrafts : store.restoreSubmittingDrafts;
      settle(submissionId);
      settle(submissionId);
      expect(store.getPendingDrafts(ownerKey).map((draft) => draft.id)).toEqual(
        outcome === "accepted" ? [laterId] : [laterId, validId],
      );
      expect(store.getPendingDrafts(ownerKey).find((draft) => draft.id === laterId)?.text).toBe(
        "Newer edit",
      );
      expect(store.getPendingDrafts(otherOwnerKey).map((draft) => draft.filePath)).toEqual([
        "src/missing.ts",
      ]);
      const saved = readInlineCommentDraftsFromStorage({ storage, ownerKey });
      if (saved.status !== "restored") throw new Error("Expected saved remaining drafts.");
      expect(saved.comments.map((draft) => draft.id)).toEqual(
        outcome === "accepted" ? [laterId] : [validId, laterId],
      );
    },
  );
}
