import { describe, expect, test } from "bun:test";
import {
  createEmptyComposerDraft,
  draftToSerializedText,
} from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import type {
  InlineCommentDraft,
  InlineCommentDraftSnapshot,
} from "@/state/use-inline-comment-draft-store";
import { toInlineCommentDraftStorageKey } from "@/state/inline-comment-draft-storage";
import {
  type AgentStudioReviewCommentStore,
  createAgentStudioReviewCommentComposerAdapter,
} from "./use-agent-studio-review-comment-composer-adapter";

const OWNER = toInlineCommentDraftStorageKey({ workspaceId: "workspace-1", taskId: "task-1" });

type FakeReviewCommentStore = {
  getStore: () => AgentStudioReviewCommentStore;
  addDraft: (draft: InlineCommentDraft) => void;
  updateDraft: (id: string, text: string, revision: number) => void;
  setOnFormat: (onFormat: (() => void) | null) => void;
  hydrated: () => number;
  flushed: () => number;
};

const buildComment = (
  id: string,
  revision: number,
  text: string,
  status: InlineCommentDraft["status"] = "pending",
): InlineCommentDraft => ({
  id,
  filePath: `packages/frontend/src/${id}.ts`,
  diffScope: "uncommitted",
  startLine: revision,
  endLine: revision,
  side: "new",
  text,
  codeContext: [{ lineNumber: revision, text: `const ${id} = true;`, isSelected: true }],
  language: "ts",
  revision,
  submissionId: status === "submitting" ? `existing-${id}` : null,
  createdAt: revision,
  updatedAt: revision,
  status,
});

const createFakeReviewCommentStore = (
  initialDrafts: InlineCommentDraft[],
): FakeReviewCommentStore => {
  const drafts = initialDrafts.map((draft) => ({ ...draft }));
  let nextSubmissionId = 0;
  let onFormat: (() => void) | null = null;
  let hydrateCount = 0;
  let flushCount = 0;

  const getPendingDrafts = (ownerKey: string): InlineCommentDraft[] => {
    expect(ownerKey).toBe(OWNER);
    return drafts.filter((draft) => draft.status === "pending");
  };

  const beginSubmittingDrafts = (
    ownerKey: string,
    snapshots: InlineCommentDraftSnapshot[],
  ): string | null => {
    expect(ownerKey).toBe(OWNER);
    const submissionId = `submission-${++nextSubmissionId}`;
    let didTransition = false;
    for (const draft of drafts) {
      if (
        draft.status === "pending" &&
        snapshots.some(
          (snapshot) => snapshot.id === draft.id && snapshot.revision === draft.revision,
        )
      ) {
        draft.status = "submitting";
        draft.submissionId = submissionId;
        didTransition = true;
      }
    }
    return didTransition ? submissionId : null;
  };

  const store: AgentStudioReviewCommentStore = {
    getPendingDrafts,
    formatBatchMessage: (pendingDrafts) => {
      const message = [
        "## Git Diff Comments",
        ...pendingDrafts.map((draft) => `Instruction: ${draft.text}`),
      ].join("\n\n");
      onFormat?.();
      return message;
    },
    beginSubmittingDrafts,
    restoreSubmittingDrafts: (submissionId) => {
      for (const draft of drafts) {
        if (draft.status === "submitting" && draft.submissionId === submissionId) {
          draft.status = "pending";
          draft.submissionId = null;
        }
      }
    },
    completeSubmittingDrafts: (submissionId) => {
      for (let index = drafts.length - 1; index >= 0; index -= 1) {
        const draft = drafts[index];
        if (draft?.status === "submitting" && draft.submissionId === submissionId) {
          drafts.splice(index, 1);
        }
      }
    },
    hydrate: () => {
      hydrateCount += 1;
    },
    flush: () => {
      flushCount += 1;
    },
  };

  return {
    getStore: () => store,
    addDraft: (draft) => {
      drafts.push({ ...draft });
    },
    updateDraft: (id, text, revision) => {
      const draft = drafts.find((candidate) => candidate.id === id);
      if (!draft) {
        throw new Error(`Missing ${id} comment fixture.`);
      }
      draft.text = text;
      draft.revision = revision;
    },
    setOnFormat: (nextOnFormat) => {
      onFormat = nextOnFormat;
    },
    hydrated: () => hydrateCount,
    flushed: () => flushCount,
  };
};

describe("Agent Studio review comment composer adapter", () => {
  test("formats pending comments and sends them when the typed draft is empty", async () => {
    const fakeStore = createFakeReviewCommentStore([
      buildComment("first-comment", 1, "Keep this branch explicit."),
    ]);
    const adapter = createAgentStudioReviewCommentComposerAdapter(fakeStore.getStore);
    let sentText = "";

    const didSend = await adapter.submitDraft(OWNER, createEmptyComposerDraft(), async (draft) => {
      sentText = draftToSerializedText(draft);
      expect(fakeStore.getStore().getPendingDrafts(OWNER)).toEqual([]);
      return true;
    });

    expect(didSend).toBe(true);
    expect(sentText).toBe("## Git Diff Comments\n\nInstruction: Keep this branch explicit.");
  });

  test("restores the exact pending comments when send returns false", async () => {
    const fakeStore = createFakeReviewCommentStore([
      buildComment("first-comment", 1, "Keep this branch explicit."),
    ]);
    const adapter = createAgentStudioReviewCommentComposerAdapter(fakeStore.getStore);

    const didSend = await adapter.submitDraft(OWNER, createEmptyComposerDraft(), async () => false);

    expect(didSend).toBe(false);
    expect(
      fakeStore
        .getStore()
        .getPendingDrafts(OWNER)
        .map(({ id, revision, status }) => ({
          id,
          revision,
          status,
        })),
    ).toEqual([{ id: "first-comment", revision: 1, status: "pending" }]);
  });

  test("restores pending comments and propagates a thrown send failure", async () => {
    const fakeStore = createFakeReviewCommentStore([
      buildComment("first-comment", 1, "Keep this branch explicit."),
    ]);
    const adapter = createAgentStudioReviewCommentComposerAdapter(fakeStore.getStore);

    await expect(
      adapter.submitDraft(OWNER, createEmptyComposerDraft(), async () => {
        throw new Error("Runtime send failed");
      }),
    ).rejects.toThrow("Runtime send failed");
    expect(
      fakeStore
        .getStore()
        .getPendingDrafts(OWNER)
        .map(({ id, revision, status }) => ({
          id,
          revision,
          status,
        })),
    ).toEqual([{ id: "first-comment", revision: 1, status: "pending" }]);
  });

  test("does not complete an edited revision or a comment added during an older send", async () => {
    const fakeStore = createFakeReviewCommentStore([
      buildComment("edited-comment", 1, "Original instruction."),
      buildComment("sent-comment", 2, "Send this instruction."),
    ]);
    fakeStore.setOnFormat(() => {
      const editedDraft = fakeStore
        .getStore()
        .getPendingDrafts(OWNER)
        .find((draft) => draft.id === "edited-comment");
      if (!editedDraft) {
        throw new Error("Missing edited comment fixture.");
      }
      editedDraft.text = "Updated instruction.";
      editedDraft.revision = 3;
    });
    const adapter = createAgentStudioReviewCommentComposerAdapter(fakeStore.getStore);

    await adapter.submitDraft(OWNER, createEmptyComposerDraft(), async () => {
      fakeStore.addDraft(buildComment("new-comment", 4, "Added during send."));
      fakeStore.updateDraft("new-comment", "Edited during send.", 5);
      return true;
    });

    expect(
      fakeStore
        .getStore()
        .getPendingDrafts(OWNER)
        .map(({ id, revision, status }) => ({
          id,
          revision,
          status,
        })),
    ).toEqual([
      { id: "edited-comment", revision: 3, status: "pending" },
      { id: "new-comment", revision: 5, status: "pending" },
    ]);
  });

  test("sends the caller draft unchanged when no comment owner exists", async () => {
    const fakeStore = createFakeReviewCommentStore([
      buildComment("first-comment", 1, "Must not be sent."),
    ]);
    const adapter = createAgentStudioReviewCommentComposerAdapter(fakeStore.getStore);
    let sentText = "";

    const didSend = await adapter.submitDraft(null, createEmptyComposerDraft(), async (draft) => {
      sentText = draftToSerializedText(draft);
      return true;
    });

    expect(didSend).toBe(true);
    expect(sentText).toBe("");
    expect(fakeStore.getStore().getPendingDrafts(OWNER)).toHaveLength(1);
  });

  test("delegates hydration and flush to the store", () => {
    const fakeStore = createFakeReviewCommentStore([]);
    const adapter = createAgentStudioReviewCommentComposerAdapter(fakeStore.getStore);

    adapter.hydrate();
    adapter.flush();

    expect(fakeStore.hydrated()).toBe(1);
    expect(fakeStore.flushed()).toBe(1);
  });
});
