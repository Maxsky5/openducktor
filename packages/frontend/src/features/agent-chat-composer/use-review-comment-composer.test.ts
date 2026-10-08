import { describe, expect, test } from "bun:test";
import {
  createEmptyComposerDraft,
  createSlashCommandSegment,
  draftToSerializedText,
} from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import type {
  InlineCommentDraft,
  InlineCommentDraftSnapshot,
} from "@/state/use-inline-comment-draft-store";
import { toInlineCommentDraftStorageKey } from "@/state/inline-comment-draft-storage";
import { type ReviewCommentStore, sendReviewComments } from "./use-review-comment-composer";

const OWNER = toInlineCommentDraftStorageKey({ workspaceId: "workspace-1", taskId: "task-1" });

type TestStore = {
  getStore: () => ReviewCommentStore;
  addDraft: (draft: InlineCommentDraft) => void;
  updateDraft: (id: string, text: string, revision: number) => void;
  setOnFormat: (onFormat: (() => void) | null) => void;
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

const createStore = (initialDrafts: InlineCommentDraft[]): TestStore => {
  const drafts = initialDrafts.map((draft) => ({ ...draft }));
  let nextSubmissionId = 0;
  let onFormat: (() => void) | null = null;

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

  const store: ReviewCommentStore = {
    getPendingDrafts,
    getPersistenceWarning: () => null,
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
  };
};

describe("sendReviewComments", () => {
  test("includes comments in runtime slash commands that send user messages", async () => {
    const store = createStore([buildComment("first-comment", 1, "Review this branch.")]);
    const draft = {
      segments: [
        createSlashCommandSegment({
          id: "review",
          trigger: "review",
          title: "Review",
          source: "command",
          hints: [],
        }),
      ],
    };
    let sentText = "";

    const didSend = await sendReviewComments(
      OWNER,
      draft,
      async (message) => {
        sentText = draftToSerializedText(message);
        return true;
      },
      store.getStore,
    );

    expect(didSend).toBe(true);
    expect(sentText).toContain("/review");
    expect(sentText).toContain("Instruction: Review this branch.");
    expect(store.getStore().getPendingDrafts(OWNER)).toEqual([]);
  });

  test("formats pending comments and sends them when the typed draft is empty", async () => {
    const store = createStore([buildComment("first-comment", 1, "Keep this branch explicit.")]);
    let sentText = "";

    const didSend = await sendReviewComments(
      OWNER,
      createEmptyComposerDraft(),
      async (draft) => {
        sentText = draftToSerializedText(draft);
        expect(store.getStore().getPendingDrafts(OWNER)).toEqual([]);
        return true;
      },
      store.getStore,
    );

    expect(didSend).toBe(true);
    expect(sentText).toBe("## Git Diff Comments\n\nInstruction: Keep this branch explicit.");
  });

  test("restores the exact pending comments when send returns false", async () => {
    const store = createStore([buildComment("first-comment", 1, "Keep this branch explicit.")]);

    const didSend = await sendReviewComments(
      OWNER,
      createEmptyComposerDraft(),
      async () => false,
      store.getStore,
    );

    expect(didSend).toBe(false);
    expect(
      store
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
    const store = createStore([buildComment("first-comment", 1, "Keep this branch explicit.")]);

    await expect(
      sendReviewComments(
        OWNER,
        createEmptyComposerDraft(),
        async () => {
          throw new Error("Runtime send failed");
        },
        store.getStore,
      ),
    ).rejects.toThrow("Runtime send failed");
    expect(
      store
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
    const store = createStore([
      buildComment("edited-comment", 1, "Original instruction."),
      buildComment("sent-comment", 2, "Send this instruction."),
    ]);
    store.setOnFormat(() => {
      const editedDraft = store
        .getStore()
        .getPendingDrafts(OWNER)
        .find((draft) => draft.id === "edited-comment");
      if (!editedDraft) {
        throw new Error("Missing edited comment fixture.");
      }
      editedDraft.text = "Updated instruction.";
      editedDraft.revision = 3;
    });

    await sendReviewComments(
      OWNER,
      createEmptyComposerDraft(),
      async () => {
        store.addDraft(buildComment("new-comment", 4, "Added during send."));
        store.updateDraft("new-comment", "Edited during send.", 5);
        return true;
      },
      store.getStore,
    );

    expect(
      store
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
    const store = createStore([buildComment("first-comment", 1, "Must not be sent.")]);
    let sentText = "";

    const didSend = await sendReviewComments(
      null,
      createEmptyComposerDraft(),
      async (draft) => {
        sentText = draftToSerializedText(draft);
        return true;
      },
      store.getStore,
    );

    expect(didSend).toBe(true);
    expect(sentText).toBe("");
    expect(store.getStore().getPendingDrafts(OWNER)).toHaveLength(1);
  });
});
