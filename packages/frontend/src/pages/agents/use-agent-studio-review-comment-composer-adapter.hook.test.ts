import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { toInlineCommentDraftStorageKey } from "@/state/inline-comment-draft-storage";
import {
  resetInlineCommentDraftStoreForTests,
  setInlineCommentDraftScheduleTaskForTests,
  setInlineCommentDraftStorageForTests,
  useInlineCommentDraftStore,
} from "@/state/use-inline-comment-draft-store";
import { useAgentStudioReviewCommentComposerAdapter } from "./use-agent-studio-review-comment-composer-adapter";

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

describe("useAgentStudioReviewCommentComposerAdapter", () => {
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
      useAgentStudioReviewCommentComposerAdapter({
        workspaceId: "workspace-1",
        taskId: "task-1",
        onSend: async () => true,
      }),
    );

    expect(rendered.result.current.pendingInlineCommentCount).toBe(1);
    expect(useInlineCommentDraftStore.getState().isHydrated).toBe(true);
    rendered.unmount();
  });

  test("flushes pending comments on pagehide so a comment written before quitting survives", async () => {
    const rendered = renderHook(() =>
      useAgentStudioReviewCommentComposerAdapter({
        workspaceId: "workspace-1",
        taskId: "task-1",
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

    await waitFor(() => {
      expect(storage.getItem(OWNER_KEY)).not.toBeNull();
    });
    expect(rendered.result.current.pendingInlineCommentCount).toBe(1);
    rendered.unmount();
  });
});
