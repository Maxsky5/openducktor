import { afterEach, describe, expect, test } from "bun:test";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import {
  type AgentChatComposerDraft,
  createEmptyComposerDraft,
  createTextSegment,
} from "./agent-chat-composer-draft";
import {
  type AgentChatDraftSessionIdentity,
  toAgentChatDraftStorageKey,
} from "./agent-chat-draft-storage";
import {
  flushAgentChatDraft,
  resetAgentChatDraftStoreForTests,
  setAgentChatDraftStorageForTests,
} from "./agent-chat-draft-store";
import { useAgentChatComposerDraftState } from "./use-agent-chat-composer-draft-state";

type TestStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
type HookArgs = Parameters<typeof useAgentChatComposerDraftState>[0];
type HookResult = ReturnType<typeof useAgentChatComposerDraftState>;

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

const identity: AgentChatDraftSessionIdentity = {
  workspaceId: "workspace",
  externalSessionId: "session-a",
  runtimeKind: "opencode",
  workingDirectory: "/repo",
};

const buildDraft = (text: string): AgentChatComposerDraft => ({
  segments: [createTextSegment(text, "text-1")],
  attachments: [],
});

const mountHarness = async (args: Partial<HookArgs> = {}) => {
  const harness = createHookHarness<HookArgs, HookResult>(useAgentChatComposerDraftState, {
    draftStateKey: "composer-key",
    persistenceIdentity: identity,
    taskId: "task-1",
    ...args,
  });
  await harness.mount();
  return harness;
};

afterEach(() => {
  resetAgentChatDraftStoreForTests();
});

describe("useAgentChatComposerDraftState", () => {
  test("rehydrates the draft entry when only the task id changes", async () => {
    const storage = createMemoryStorage();
    setAgentChatDraftStorageForTests(storage);
    const harness = await mountHarness();

    await harness.run((value) => {
      value.commitDraft(buildDraft("same session"));
    });
    await harness.update({
      draftStateKey: "composer-key",
      persistenceIdentity: identity,
      taskId: "task-2",
    });
    await flushAgentChatDraft(identity);

    const raw = storage.getItem(toAgentChatDraftStorageKey(identity));
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? "{}")).toEqual(expect.objectContaining({ taskId: "task-2" }));
    await harness.unmount();
  });

  test("persists a failed-send restoration when the visible draft is empty", async () => {
    const storage = createMemoryStorage();
    setAgentChatDraftStorageForTests(storage);
    const harness = await mountHarness();
    const submittedDraft = buildDraft("restore me");
    let snapshot: ReturnType<HookResult["createSubmittedDraftSnapshot"]> | null = null;

    await harness.run((value) => {
      value.commitDraft(submittedDraft);
      const nextSnapshot = value.createSubmittedDraftSnapshot(submittedDraft);
      snapshot = nextSnapshot;
      value.clearSubmittedDraft(nextSnapshot);
      value.setDisplayedDraft(createEmptyComposerDraft());
    });

    expect(storage.getItem(toAgentChatDraftStorageKey(identity))).toBeNull();
    await harness.run((value) => {
      if (!snapshot) {
        throw new Error("Expected submitted draft snapshot");
      }
      value.restoreSubmittedDraft(snapshot);
    });
    await flushAgentChatDraft(identity);

    const raw = storage.getItem(toAgentChatDraftStorageKey(identity));
    expect(harness.getLatest().draft.segments[0]).toEqual(
      expect.objectContaining({ text: "restore me" }),
    );
    expect(raw).toContain("restore me");
    await harness.unmount();
  });
});
