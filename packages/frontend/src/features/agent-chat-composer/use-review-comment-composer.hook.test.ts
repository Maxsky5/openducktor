import type { AgentChatSendResult } from "@/components/features/agents/agent-chat/agent-chat-send-result";
import { MANUAL_SESSION_COMPACTION_SLASH_COMMAND } from "@openducktor/contracts";
import { classifySystemSlashCommandInvocation } from "@openducktor/core";
import { toast } from "sonner";
import { setInlineCommentDraftPersistenceErrorReporter } from "@/state/use-inline-comment-draft-store";
import type { InlineCommentOwner } from "@/types/inline-comment-owner";
import {
  type AgentChatComposerDraft,
  createSlashCommandSegment,
  createTextSegment,
  draftToSerializedText,
  resolveDraftToUserMessageParts,
} from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { toInlineCommentDraftStorageKey } from "@/state/inline-comment-draft-storage";
import {
  resetInlineCommentDraftStoreForTests,
  setInlineCommentDraftScheduleTaskForTests,
  setInlineCommentDraftStorageForTests,
  useInlineCommentDraftStore,
} from "@/state/use-inline-comment-draft-store";
import { useReviewCommentComposer } from "./use-review-comment-composer";

type TestStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

const createMemoryStorage = (): TestStorage => {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
};

const OWNER_KEY = toInlineCommentDraftStorageKey({
  workspaceId: "workspace-1",
  taskId: "task-1",
});

const buildStoredPayload = (text: string): string =>
  JSON.stringify({
    version: 1,
    workspaceId: "workspace-1",
    taskId: "task-1",
    updatedAt: new Date().toISOString(),
    comments: [
      {
        id: "stored-comment",
        filePath: "packages/frontend/src/stored.ts",
        diffScope: "uncommitted",
        side: "new",
        startLine: 3,
        endLine: 3,
        text,
        codeContext: [{ lineNumber: 3, text: "const stored = true;", isSelected: true }],
        language: "ts",
        createdAt: 1_700_000_000_000,
      },
    ],
  });

describe("useReviewCommentComposer", () => {
  let storage: TestStorage;

  beforeEach(() => {
    resetInlineCommentDraftStoreForTests();
    storage = createMemoryStorage();
    setInlineCommentDraftStorageForTests(storage);
    setInlineCommentDraftScheduleTaskForTests(() => () => {});
  });

  afterEach(() => {
    resetInlineCommentDraftStoreForTests();
  });

  test("hydrates stored comments on mount and exposes their pending count", () => {
    storage.setItem(OWNER_KEY, buildStoredPayload("Restored instruction"));

    const rendered = renderHook(() =>
      useReviewCommentComposer({
        owner: { kind: "task", workspaceId: "workspace-1", taskId: "task-1" },
        onSend: async () => true,
      }),
    );

    expect(rendered.result.current.pendingSendItems?.count).toBe(1);
    expect(useInlineCommentDraftStore.getState().hydratedOwners[OWNER_KEY]).toBe(true);
    rendered.unmount();
  });

  test("flushes pending comments on pagehide so a comment written before quitting survives", () => {
    const rendered = renderHook(() =>
      useReviewCommentComposer({
        owner: { kind: "task", workspaceId: "workspace-1", taskId: "task-1" },
        onSend: async () => true,
      }),
    );

    act(() => {
      useInlineCommentDraftStore.getState().addDraft(OWNER_KEY, {
        filePath: "packages/frontend/src/pending.ts",
        diffScope: "uncommitted",
        startLine: 7,
        endLine: 7,
        side: "new",
        text: "Pending instruction",
        codeContext: [{ lineNumber: 7, text: "const pending = true;", isSelected: true }],
        language: "ts",
      });
    });
    expect(storage.getItem(OWNER_KEY)).toBeNull();

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(storage.getItem(OWNER_KEY)).not.toBeNull();
    expect(rendered.result.current.pendingSendItems?.count).toBe(1);
    rendered.unmount();
  });
  test.each([
    ["task", "compact"],
    ["workspace_session", "compact"],
    ["task", "other"],
    ["workspace_session", "other"],
  ] as const)("keeps %s comments pending for system command %s", async (kind, trigger) => {
    const owner: InlineCommentOwner =
      kind === "task"
        ? { kind, workspaceId: "workspace-1", taskId: "task-1" }
        : { kind, workspaceId: "workspace-1", sessionId: "chat-1" };
    const ownerKey = toInlineCommentDraftStorageKey(
      kind === "task"
        ? { workspaceId: "workspace-1", taskId: "task-1" }
        : { workspaceId: "workspace-1", workspaceSessionId: "chat-1" },
    );
    const command =
      trigger === "compact"
        ? { ...MANUAL_SESSION_COMPACTION_SLASH_COMMAND }
        : {
            id: "system:other",
            trigger,
            title: "Other command",
            source: "system" as const,
            hints: [],
          };
    const draft = { segments: [createSlashCommandSegment(command)] };
    const sent: AgentChatComposerDraft[] = [];
    let accepted = false;
    const view = renderHook(() =>
      useReviewCommentComposer({
        owner,
        onSend: async (message) => {
          sent.push(message);
          if (trigger === "compact" && sent.length <= 2) {
            const parts = await resolveDraftToUserMessageParts(message, async () => "");
            expect(classifySystemSlashCommandInvocation(parts).kind).toBe(
              "manual_session_compaction",
            );
          }
          return accepted;
        },
      }),
    );
    act(() => {
      useInlineCommentDraftStore.getState().addDraft(ownerKey, {
        filePath: "src/a.ts",
        diffScope: "uncommitted",
        startLine: 1,
        endLine: 1,
        side: "new",
        text: "Pending instruction",
        codeContext: [],
      });
    });
    for (const outcome of [false, true]) {
      accepted = outcome;
      await act(async () => {
        expect(await view.result.current.onSend(draft)).toBe(outcome);
      });
      expect(sent.at(-1)).toEqual(draft);
      expect(view.result.current.pendingSendItems?.count).toBe(1);
      expect(useInlineCommentDraftStore.getState().getPendingDrafts(ownerKey)[0]?.text).toBe(
        "Pending instruction",
      );
    }
    await act(async () => {
      expect(
        await view.result.current.onSend({ segments: [createTextSegment("Review these changes")] }),
      ).toBe(true);
    });
    expect(draftToSerializedText(sent[2]!)).toContain("Review these changes");
    expect(draftToSerializedText(sent[2]!)).toContain("Instruction: Pending instruction");
    expect(view.result.current.pendingSendItems).toBeNull();
    view.unmount();
  });
  test.each(["task", "workspace_session"] as const)(
    "settles the captured %s owner after selection changes",
    async (kind) => {
      const first: InlineCommentOwner =
        kind === "task"
          ? { kind, workspaceId: "workspace-1", taskId: "task-1" }
          : { kind, workspaceId: "workspace-1", sessionId: "task-1" };
      const second: InlineCommentOwner = {
        kind: "workspace_session",
        workspaceId: "workspace-2",
        sessionId: "task-1",
      };
      const firstKey = toInlineCommentDraftStorageKey(
        kind === "task"
          ? { workspaceId: "workspace-1", taskId: "task-1" }
          : { workspaceId: "workspace-1", workspaceSessionId: "task-1" },
      );
      const secondKey = toInlineCommentDraftStorageKey({
        workspaceId: "workspace-2",
        workspaceSessionId: "task-1",
      });
      const input = {
        filePath: "src/a.ts",
        diffScope: "target" as const,
        startLine: 2,
        endLine: 4,
        side: "old" as const,
        text: "Original comment",
        codeContext: [{ lineNumber: 3, text: "removed code", isSelected: true }],
        language: "ts",
      };
      useInlineCommentDraftStore.getState().addDraft(firstKey, input);
      useInlineCommentDraftStore
        .getState()
        .addDraft(secondKey, { ...input, text: "Other workspace" });
      const accepted = Promise.withResolvers<boolean>();
      let sentText = "";
      const firstSend = (
        draft: Parameters<ReturnType<typeof useReviewCommentComposer>["onSend"]>[0],
      ) => {
        sentText = draftToSerializedText(draft);
        return accepted.promise;
      };
      const view = renderHook(({ owner, onSend }) => useReviewCommentComposer({ owner, onSend }), {
        initialProps: { owner: first, onSend: firstSend },
      });
      let result!: Promise<AgentChatSendResult>;
      act(() => {
        result = view.result.current.onSend({
          segments: [createTextSegment("User text")],
        });
      });
      expect(view.result.current.pendingSendItems).toBeNull();
      expect(sentText).toContain("User text");
      expect(sentText).toContain("Change: removed");
      expect(sentText).toContain("Lines: 2-4");
      expect(sentText).toContain("3 | removed code");
      expect(sentText).not.toContain("Other workspace");
      act(() =>
        useInlineCommentDraftStore
          .getState()
          .addDraft(firstKey, { ...input, text: "Later comment" }),
      );
      view.rerender({ owner: second, onSend: async () => false });
      expect(view.result.current.pendingSendItems?.count).toBe(1);
      await act(async () => {
        accepted.resolve(true);
        expect(await result).toBe(true);
      });
      expect(
        useInlineCommentDraftStore
          .getState()
          .getPendingDrafts(firstKey)
          .map((draft) => draft.text),
      ).toEqual(["Later comment"]);
      expect(view.result.current.pendingSendItems?.count).toBe(1);
      view.unmount();
    },
  );
  test("keeps accepted comments cleared when removing their saved record fails", async () => {
    const owner: InlineCommentOwner = {
      kind: "workspace_session",
      workspaceId: "workspace-1",
      sessionId: "chat",
    };
    const ownerKey = toInlineCommentDraftStorageKey({
      workspaceId: "workspace-1",
      workspaceSessionId: "chat",
    });
    const input = {
      filePath: "src/a.ts",
      diffScope: "uncommitted" as const,
      startLine: 1,
      endLine: 1,
      side: "new" as const,
      text: "Accepted note",
      codeContext: [],
    };
    useInlineCommentDraftStore.getState().addDraft(ownerKey, input);
    useInlineCommentDraftStore.getState().flush();
    storage.removeItem = () => {
      throw new Error("Storage remove failed");
    };
    setInlineCommentDraftPersistenceErrorReporter(() => {});
    const notice = spyOn(toast, "error").mockImplementation(() => "reported");
    const view = renderHook(() => useReviewCommentComposer({ owner, onSend: async () => true }));
    try {
      await act(async () => {
        expect(await view.result.current.onSend({ segments: [] })).toBe(true);
      });
      expect(useInlineCommentDraftStore.getState().draftsByOwner[ownerKey]).toEqual([]);
      expect(notice).toHaveBeenCalledWith("Message sent, but the comment save failed", {
        description: "These comments are not saved for this session.",
      });
    } finally {
      view.unmount();
      notice.mockRestore();
    }
  });
});
