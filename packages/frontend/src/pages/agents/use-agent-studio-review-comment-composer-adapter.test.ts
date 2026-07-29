import { describe, expect, test } from "bun:test";
import {
  createEmptyComposerDraft,
  draftToSerializedText,
} from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import type { AgentChatDraftScope } from "@/components/features/agents/agent-chat/agent-chat-draft-scope";
import type {
  InlineCommentDraft,
  InlineCommentDraftSnapshot,
} from "@/state/use-inline-comment-draft-store";
import {
  type AgentStudioReviewCommentStore,
  createAgentStudioReviewCommentComposerAdapter,
} from "./use-agent-studio-review-comment-composer-adapter";

type FakeReviewCommentStore = {
  getStore: () => AgentStudioReviewCommentStore;
  addDraft: (draft: InlineCommentDraft) => void;
  updateDraft: (id: string, text: string, revision: number) => void;
  setOnFormat: (onFormat: (() => void) | null) => void;
  resetKeys: string[];
  setKeys: string[];
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
  initialDraftStateKey = "task-1:build:new",
): FakeReviewCommentStore => {
  const drafts = initialDrafts.map((draft) => ({ ...draft }));
  const resetKeys: string[] = [];
  const setKeys: string[] = [];
  let draftStateKey = initialDraftStateKey;
  let nextSubmissionId = 0;
  let onFormat: (() => void) | null = null;

  const getPendingDrafts = (): InlineCommentDraft[] =>
    drafts.filter((draft) => draft.status === "pending");

  const beginSubmittingDrafts = (snapshots: InlineCommentDraftSnapshot[]): string | null => {
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
    get drafts() {
      return drafts;
    },
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
    setDraftStateKey: (nextDraftStateKey) => {
      setKeys.push(nextDraftStateKey);
      draftStateKey = nextDraftStateKey;
    },
    resetForContext: (nextDraftStateKey) => {
      resetKeys.push(nextDraftStateKey);
      if (draftStateKey === nextDraftStateKey) {
        return;
      }
      drafts.splice(0, drafts.length);
      draftStateKey = nextDraftStateKey;
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
    resetKeys,
    setKeys,
  };
};

const buildScope = (
  taskId: string,
  role: AgentChatDraftScope["role"],
  externalSessionId: string | null,
): AgentChatDraftScope => ({
  taskId,
  role,
  session:
    externalSessionId === null
      ? null
      : {
          externalSessionId,
          runtimeKind: "opencode",
          workingDirectory: "/repo",
        },
});

describe("Agent Studio review comment composer adapter", () => {
  test("formats pending comments and sends them when the typed draft is empty", async () => {
    const fakeStore = createFakeReviewCommentStore([
      buildComment("first-comment", 1, "Keep this branch explicit."),
    ]);
    const adapter = createAgentStudioReviewCommentComposerAdapter(fakeStore.getStore);
    let sentText = "";

    const didSend = await adapter.submitDraft(createEmptyComposerDraft(), async (draft) => {
      sentText = draftToSerializedText(draft);
      expect(fakeStore.getStore().drafts[0]?.status).toBe("submitting");
      return true;
    });

    expect(didSend).toBe(true);
    expect(sentText).toBe("## Git Diff Comments\n\nInstruction: Keep this branch explicit.");
    expect(fakeStore.getStore().drafts).toEqual([]);
  });

  test("restores the exact pending comments when send returns false", async () => {
    const fakeStore = createFakeReviewCommentStore([
      buildComment("first-comment", 1, "Keep this branch explicit."),
    ]);
    const adapter = createAgentStudioReviewCommentComposerAdapter(fakeStore.getStore);

    const didSend = await adapter.submitDraft(createEmptyComposerDraft(), async () => false);

    expect(didSend).toBe(false);
    expect(fakeStore.getStore().drafts).toMatchObject([
      {
        id: "first-comment",
        revision: 1,
        status: "pending",
        submissionId: null,
      },
    ]);
  });

  test("restores pending comments and propagates a thrown send failure", async () => {
    const fakeStore = createFakeReviewCommentStore([
      buildComment("first-comment", 1, "Keep this branch explicit."),
    ]);
    const adapter = createAgentStudioReviewCommentComposerAdapter(fakeStore.getStore);

    await expect(
      adapter.submitDraft(createEmptyComposerDraft(), async () => {
        throw new Error("Runtime send failed");
      }),
    ).rejects.toThrow("Runtime send failed");
    expect(fakeStore.getStore().drafts).toMatchObject([
      {
        id: "first-comment",
        revision: 1,
        status: "pending",
        submissionId: null,
      },
    ]);
  });

  test("does not complete an edited revision or a comment added during an older send", async () => {
    const fakeStore = createFakeReviewCommentStore([
      buildComment("edited-comment", 1, "Original instruction."),
      buildComment("sent-comment", 2, "Send this instruction."),
    ]);
    fakeStore.setOnFormat(() => {
      const editedDraft = fakeStore
        .getStore()
        .drafts.find((draft) => draft.id === "edited-comment");
      if (!editedDraft) {
        throw new Error("Missing edited comment fixture.");
      }
      editedDraft.text = "Updated instruction.";
      editedDraft.revision = 3;
    });
    const adapter = createAgentStudioReviewCommentComposerAdapter(fakeStore.getStore);

    await adapter.submitDraft(createEmptyComposerDraft(), async () => {
      fakeStore.addDraft(buildComment("new-comment", 4, "Added during send."));
      fakeStore.updateDraft("new-comment", "Edited during send.", 5);
      return true;
    });

    expect(
      fakeStore.getStore().drafts.map(({ id, revision, status }) => ({
        id,
        revision,
        status,
      })),
    ).toEqual([
      { id: "edited-comment", revision: 3, status: "pending" },
      { id: "new-comment", revision: 5, status: "pending" },
    ]);
  });

  test("preserves an in-flight transaction only for a session-only scope switch", () => {
    const fakeStore = createFakeReviewCommentStore([
      buildComment("submitting-comment", 1, "Already sending.", "submitting"),
    ]);
    const adapter = createAgentStudioReviewCommentComposerAdapter(fakeStore.getStore);
    const initialScope = buildScope("task-1", "build", null);
    const sessionScope = buildScope("task-1", "build", "session-1");

    adapter.syncDraftScope(initialScope, "task-1:build:new");
    adapter.syncDraftScope(sessionScope, "task-1:build:session-1");

    expect(fakeStore.setKeys).toEqual(["task-1:build:session-1"]);
    expect(fakeStore.getStore().drafts).toHaveLength(1);

    const roleScope = buildScope("task-1", "qa", "session-1");
    adapter.syncDraftScope(roleScope, "task-1:qa:session-1");
    expect(fakeStore.resetKeys).toContain("task-1:qa:session-1");
    expect(fakeStore.getStore().drafts).toEqual([]);

    fakeStore.addDraft(buildComment("pending-comment", 2, "Not sending."));
    const nextSessionScope = buildScope("task-1", "qa", "session-2");
    adapter.syncDraftScope(nextSessionScope, "task-1:qa:session-2");
    expect(fakeStore.getStore().drafts).toEqual([]);

    fakeStore.addDraft(buildComment("next-task-comment", 3, "Different task."));
    const taskScope = buildScope("task-2", "qa", "session-2");
    adapter.syncDraftScope(taskScope, "task-2:qa:session-2");
    expect(fakeStore.getStore().drafts).toEqual([]);
  });
});
