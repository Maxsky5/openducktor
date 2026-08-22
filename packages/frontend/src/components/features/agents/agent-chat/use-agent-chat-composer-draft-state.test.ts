import { hasRuntimeType } from "@openducktor/contracts";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import {
  type AgentChatComposerDraft,
  createEmptyComposerDraft,
  createTextSegment,
  draftHasMeaningfulContent,
} from "./agent-chat-composer-draft";
import type { AgentChatDraftPersistence, AgentChatDraftScope } from "./agent-chat-draft-scope";
import { useAgentChatComposerDraftState } from "./use-agent-chat-composer-draft-state";

type HookArgs = Parameters<typeof useAgentChatComposerDraftState>[0];
type HookResult = ReturnType<typeof useAgentChatComposerDraftState>;

const buildDraft = (text: string): AgentChatComposerDraft => ({
  segments: [createTextSegment(text, "text-1")],
  attachments: [],
});

const createDeferred = () => {
  let resolvePromise: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
};

let fakePersistenceId = 0;

const createFakePersistence = (
  initialDraft: AgentChatComposerDraft = createEmptyComposerDraft(),
  flush: () => Promise<void> = async () => {},
) => {
  let draft = initialDraft;
  let version = 0;
  const clear = mock((options?: { onlyIfVersion?: number | null }) => {
    if (hasRuntimeType(options?.onlyIfVersion, "number") && options.onlyIfVersion !== version) {
      return false;
    }
    draft = createEmptyComposerDraft();
    return true;
  });
  const adapter: AgentChatDraftPersistence = {
    targetKey: `fake-persistence:${fakePersistenceId++}`,
    hydrate: () => draft,
    set: (nextDraft) => {
      draft = nextDraft;
      version += 1;
      return version;
    },
    readVersion: () => version,
    clear,
    flush: mock(flush),
  };
  return {
    adapter,
    clear,
    readDraft: () => draft,
  };
};

const mountHarness = async (scope: AgentChatDraftScope) => {
  const harness = createHookHarness<HookArgs, HookResult>(useAgentChatComposerDraftState, {
    scope,
  });
  await harness.mount();
  return harness;
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useAgentChatComposerDraftState", () => {
  test("adopts fresh equivalent persistence wrappers without scheduling another render", async () => {
    const adapters: AgentChatDraftPersistence[] = [];
    const hydrate = mock(createEmptyComposerDraft);
    const useInlinePersistenceDraftState = (_props: { render: number }) => {
      const adapter: AgentChatDraftPersistence = {
        targetKey: "equivalent-target",
        hydrate,
        set: mock(() => 1),
        readVersion: () => 0,
        clear: () => true,
        flush: mock(async () => {}),
      };
      adapters.push(adapter);
      return useAgentChatComposerDraftState({
        scope: {
          key: "conversation:equivalent-wrapper",
          persistence: adapter,
        },
      });
    };
    const harness = createHookHarness(useInlinePersistenceDraftState, { render: 0 });

    await harness.mount();
    expect(adapters).toHaveLength(1);

    await harness.update({ render: 1 });
    expect(adapters).toHaveLength(2);
    expect(hydrate).toHaveBeenCalledTimes(1);
    const adoptedAdapter = adapters[1];
    if (!adoptedAdapter) {
      throw new Error("Expected the rerendered persistence adapter.");
    }

    const updatedDraft = buildDraft("updated through adopted wrapper");
    await harness.run((value) => {
      value.commitDraft(updatedDraft);
    });
    expect(adoptedAdapter.set).toHaveBeenCalledWith(updatedDraft);
    expect(adapters).toHaveLength(3);

    const latestAdapter = adapters[2];
    if (!latestAdapter) {
      throw new Error("Expected the latest persistence adapter.");
    }
    window.dispatchEvent(new Event("pagehide"));
    expect(latestAdapter.flush).toHaveBeenCalledTimes(1);

    await harness.unmount();
    expect(latestAdapter.flush).toHaveBeenCalledTimes(2);
  });

  test("keeps an opaque non-task draft identity in memory without persistence", async () => {
    const harness = await mountHarness({
      key: "repository-chat:conversation/42",
      persistence: null,
    });

    await harness.run((value) => {
      value.commitDraft(buildDraft("local only"));
    });
    expect(harness.getLatest().draft.segments[0]).toEqual(
      expect.objectContaining({ text: "local only" }),
    );

    await harness.update({
      scope: {
        key: "repository-chat:conversation/43",
        persistence: null,
      },
    });
    expect(draftHasMeaningfulContent(harness.getLatest().draft)).toBe(false);
    await harness.unmount();
  });

  test("adopts persistence for the same key and hydrates an empty in-memory draft", async () => {
    const persistence = createFakePersistence(buildDraft("persisted"));
    const harness = await mountHarness({
      key: "conversation:late-persistence",
      persistence: null,
    });

    await harness.update({
      scope: {
        key: "conversation:late-persistence",
        persistence: persistence.adapter,
      },
    });

    expect(harness.getLatest().draft.segments[0]).toEqual(
      expect.objectContaining({ text: "persisted" }),
    );
    await harness.run((value) => {
      value.commitDraft(buildDraft("updated"));
    });
    expect(persistence.readDraft().segments[0]).toEqual(
      expect.objectContaining({ text: "updated" }),
    );

    window.dispatchEvent(new Event("pagehide"));
    expect(persistence.adapter.flush).toHaveBeenCalledTimes(1);
    await harness.unmount();
    expect(persistence.adapter.flush).toHaveBeenCalledTimes(2);
  });

  test("persists newer in-memory input when adding persistence for the same key", async () => {
    const persistence = createFakePersistence(buildDraft("older persisted draft"));
    const harness = await mountHarness({
      key: "conversation:late-persistence",
      persistence: null,
    });

    await harness.run((value) => {
      value.commitDraft(buildDraft("newer in-memory input"));
    });
    await harness.update({
      scope: {
        key: "conversation:late-persistence",
        persistence: persistence.adapter,
      },
    });

    expect(harness.getLatest().draft.segments[0]).toEqual(
      expect.objectContaining({ text: "newer in-memory input" }),
    );
    expect(persistence.readDraft().segments[0]).toEqual(
      expect.objectContaining({ text: "newer in-memory input" }),
    );

    await harness.unmount();
    expect(persistence.adapter.flush).toHaveBeenCalledTimes(1);
  });

  test("keeps newer input when replacing persistence for the same key", async () => {
    const first = createFakePersistence();
    const second = createFakePersistence(buildDraft("older persisted draft"));
    const harness = await mountHarness({
      key: "conversation:replacement",
      persistence: first.adapter,
    });

    await harness.run((value) => {
      value.commitDraft(buildDraft("newer input"));
    });
    await harness.update({
      scope: {
        key: "conversation:replacement",
        persistence: second.adapter,
      },
    });

    expect(first.adapter.flush).toHaveBeenCalledTimes(1);
    expect(harness.getLatest().draft.segments[0]).toEqual(
      expect.objectContaining({ text: "newer input" }),
    );
    expect(second.readDraft().segments[0]).toEqual(
      expect.objectContaining({ text: "newer input" }),
    );

    let snapshot: ReturnType<HookResult["createSubmittedDraftSnapshot"]> | null = null;
    await harness.run((value) => {
      const updatedDraft = buildDraft("replacement updated");
      value.commitDraft(updatedDraft);
      snapshot = value.createSubmittedDraftSnapshot(updatedDraft);
    });
    expect(second.readDraft().segments[0]).toEqual(
      expect.objectContaining({ text: "replacement updated" }),
    );

    await harness.run((value) => {
      if (!snapshot) {
        throw new Error("Expected submitted draft snapshot.");
      }
      value.clearSubmittedDraft(snapshot);
      value.setDisplayedDraft(createEmptyComposerDraft());
    });
    await harness.run((value) => {
      if (!snapshot) {
        throw new Error("Expected submitted draft snapshot.");
      }
      value.restoreSubmittedDraft(snapshot);
    });
    expect(first.clear).not.toHaveBeenCalled();
    expect(second.clear).toHaveBeenCalledWith({ onlyIfVersion: 2 });
    expect(second.readDraft().segments[0]).toEqual(
      expect.objectContaining({ text: "replacement updated" }),
    );

    await harness.unmount();
    expect(first.adapter.flush).toHaveBeenCalledTimes(1);
    expect(second.adapter.flush).toHaveBeenCalledTimes(1);
  });

  test("flushes the old persistence adapter before switching identities", async () => {
    const events: string[] = [];
    const pendingFlush = createDeferred();
    const first = createFakePersistence(buildDraft("first"), () => {
      events.push("flush:first");
      return pendingFlush.promise;
    });
    const second = createFakePersistence(buildDraft("second"));
    const hydrateSecond = second.adapter.hydrate;
    second.adapter.hydrate = () => {
      events.push("hydrate:second");
      return hydrateSecond();
    };
    const harness = await mountHarness({
      key: "conversation:first",
      persistence: first.adapter,
    });
    const stableCommitDraft = harness.getLatest().commitDraft;

    await harness.update({
      scope: {
        key: "conversation:second",
        persistence: second.adapter,
      },
    });

    expect(first.adapter.flush).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["flush:first", "hydrate:second"]);
    expect(harness.getLatest().draft.segments[0]).toEqual(
      expect.objectContaining({ text: "second" }),
    );
    await harness.run(() => {
      stableCommitDraft(buildDraft("second updated"));
    });
    expect(second.readDraft().segments[0]).toEqual(
      expect.objectContaining({ text: "second updated" }),
    );
    expect(first.readDraft().segments[0]).toEqual(expect.objectContaining({ text: "first" }));

    pendingFlush.resolve();
    await harness.unmount();
  });

  test("clears only the submitted persisted version", async () => {
    const persistence = createFakePersistence();
    const harness = await mountHarness({
      key: "conversation:versioned",
      persistence: persistence.adapter,
    });
    let snapshot: ReturnType<HookResult["createSubmittedDraftSnapshot"]> | null = null;

    await harness.run((value) => {
      value.commitDraft(buildDraft("submitted"));
      snapshot = value.createSubmittedDraftSnapshot(buildDraft("submitted"));
      value.commitDraft(buildDraft("new input"));
    });
    await harness.run((value) => {
      if (!snapshot) {
        throw new Error("Expected submitted draft snapshot.");
      }
      value.clearSubmittedDraft(snapshot);
    });

    expect(persistence.clear).toHaveBeenCalledWith({ onlyIfVersion: 1 });
    expect(persistence.readDraft().segments[0]).toEqual(
      expect.objectContaining({ text: "new input" }),
    );
    await harness.unmount();
  });

  test("restores a failed submission when the active draft is still empty", async () => {
    const persistence = createFakePersistence();
    const harness = await mountHarness({
      key: "conversation:failed-send",
      persistence: persistence.adapter,
    });
    const submittedDraft = buildDraft("restore me");
    let snapshot: ReturnType<HookResult["createSubmittedDraftSnapshot"]> | null = null;

    await harness.run((value) => {
      value.commitDraft(submittedDraft);
      snapshot = value.createSubmittedDraftSnapshot(submittedDraft);
      value.setDisplayedDraft(createEmptyComposerDraft());
    });
    await harness.run((value) => {
      if (!snapshot) {
        throw new Error("Expected submitted draft snapshot.");
      }
      value.restoreSubmittedDraft(snapshot);
    });

    expect(harness.getLatest().draft.segments[0]).toEqual(
      expect.objectContaining({ text: "restore me" }),
    );
    expect(persistence.readDraft().segments[0]).toEqual(
      expect.objectContaining({ text: "restore me" }),
    );
    await harness.unmount();
  });

  test("keeps new input instead of restoring an older submitted draft", async () => {
    const persistence = createFakePersistence();
    const harness = await mountHarness({
      key: "conversation:new-input",
      persistence: persistence.adapter,
    });
    const submittedDraft = buildDraft("submitted");
    let snapshot: ReturnType<HookResult["createSubmittedDraftSnapshot"]> | null = null;

    await harness.run((value) => {
      value.commitDraft(submittedDraft);
      snapshot = value.createSubmittedDraftSnapshot(submittedDraft);
      value.setDisplayedDraft(createEmptyComposerDraft());
      value.commitDraft(buildDraft("new input"));
    });
    await harness.run((value) => {
      if (!snapshot) {
        throw new Error("Expected submitted draft snapshot.");
      }
      value.restoreSubmittedDraft(snapshot);
    });

    expect(harness.getLatest().draft.segments[0]).toEqual(
      expect.objectContaining({ text: "new input" }),
    );
    await harness.unmount();
  });

  test("ignores a late restore for a no-longer-active identity", async () => {
    const first = createFakePersistence();
    const second = createFakePersistence();
    const harness = await mountHarness({
      key: "conversation:first",
      persistence: first.adapter,
    });
    const submittedDraft = buildDraft("first submission");
    let snapshot: ReturnType<HookResult["createSubmittedDraftSnapshot"]> | null = null;

    await harness.run((value) => {
      value.commitDraft(submittedDraft);
      snapshot = value.createSubmittedDraftSnapshot(submittedDraft);
      value.setDisplayedDraft(createEmptyComposerDraft());
    });
    await harness.update({
      scope: {
        key: "conversation:second",
        persistence: second.adapter,
      },
    });
    await harness.run((value) => {
      if (!snapshot) {
        throw new Error("Expected submitted draft snapshot.");
      }
      value.restoreSubmittedDraft(snapshot);
    });

    expect(draftHasMeaningfulContent(harness.getLatest().draft)).toBe(false);
    expect(draftHasMeaningfulContent(second.readDraft())).toBe(false);
    await harness.unmount();
  });

  test("flushes active persistence on page hide and unmount", async () => {
    const persistence = createFakePersistence();
    const harness = await mountHarness({
      key: "conversation:page-lifecycle",
      persistence: persistence.adapter,
    });

    window.dispatchEvent(new Event("pagehide"));
    expect(persistence.adapter.flush).toHaveBeenCalledTimes(1);

    await harness.unmount();
    expect(persistence.adapter.flush).toHaveBeenCalledTimes(2);
  });
});
