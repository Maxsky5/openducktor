import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  type AgentChatComposerDraft,
  createComposerAttachment,
  createTextSegment,
} from "./agent-chat-composer-draft";
import {
  AGENT_CHAT_DRAFT_STORAGE_MAX_BYTES,
  type AgentChatDraftSessionIdentity,
  toAgentChatDraftStorageKey,
  writeAgentChatDraftToStorage,
} from "./agent-chat-draft-storage";
import {
  clearAgentChatDraft,
  flushAgentChatDraft,
  hydrateAgentChatDraft,
  resetAgentChatDraftStoreForTests,
  setAgentChatDraft,
  setAgentChatDraftAttachmentStagerForTests,
  setAgentChatDraftNowProviderForTests,
  setAgentChatDraftPersistenceErrorReporter,
  setAgentChatDraftStorageForTests,
} from "./agent-chat-draft-store";

type TestStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

const createMemoryStorage = (spies?: {
  getItem?: (key: string) => void;
  setItem?: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
}): TestStorage => {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
    getItem: (key) => {
      spies?.getItem?.(key);
      return store.get(key) ?? null;
    },
    setItem: (key, value) => {
      spies?.setItem?.(key, value);
      store.set(key, value);
    },
    removeItem: (key) => {
      spies?.removeItem?.(key);
      store.delete(key);
    },
  };
};

const installManualTimers = () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let nextTimerId = 1;
  const timers = new Map<number, { handler: () => void; delay: number; cleared: boolean }>();

  globalThis.setTimeout = ((handler: TimerHandler, delay?: number) => {
    const timerId = nextTimerId;
    nextTimerId += 1;
    timers.set(timerId, {
      handler: () => {
        if (typeof handler === "function") {
          handler();
        }
      },
      delay: delay ?? 0,
      cleared: false,
    });
    return timerId as unknown as ReturnType<typeof globalThis.setTimeout>;
  }) as unknown as typeof globalThis.setTimeout;

  globalThis.clearTimeout = ((timerId?: ReturnType<typeof globalThis.setTimeout>) => {
    const timer = timers.get(Number(timerId));
    if (timer) {
      timer.cleared = true;
    }
  }) as typeof globalThis.clearTimeout;

  return {
    runNextByDelay: (delay: number) => {
      const timer = Array.from(timers.entries()).find(
        ([, value]) => value.delay === delay && !value.cleared,
      );
      if (!timer) {
        throw new Error(`Expected timer with delay ${delay}`);
      }
      timer[1].cleared = true;
      timer[1].handler();
    },
    restore: () => {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    },
  };
};

const createDeferred = <T>() => {
  let resolveValue: (value: T) => void = () => {};
  let rejectValue: (error: unknown) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });
  return {
    promise,
    resolve: resolveValue,
    reject: rejectValue,
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

afterEach(() => {
  resetAgentChatDraftStoreForTests();
});

describe("agent chat draft store", () => {
  test("hydrates a session from storage once and then reads from memory", () => {
    const getItem = mock((_key: string) => {});
    const storage = createMemoryStorage({ getItem });
    setAgentChatDraftStorageForTests(storage);
    writeAgentChatDraftToStorage({
      storage,
      identity,
      taskId: "task-1",
      draft: buildDraft("persisted"),
      updatedAt: "2026-07-08T10:00:00.000Z",
    });
    setAgentChatDraftNowProviderForTests(() => new Date("2026-07-08T10:00:01.000Z"));

    const firstHydration = hydrateAgentChatDraft(identity, "task-1");
    const getItemCallsAfterFirstHydration = getItem.mock.calls.length;
    const secondHydration = hydrateAgentChatDraft(identity, "task-1");

    expect(firstHydration.segments).toEqual(secondHydration.segments);
    expect(getItem.mock.calls.length).toBe(getItemCallsAfterFirstHydration);
  });

  test("coalesces dirty writes instead of writing on every draft change", async () => {
    const setItem = mock((_key: string, _value: string) => {});
    const storage = createMemoryStorage({ setItem });
    const timers = installManualTimers();
    setAgentChatDraftStorageForTests(storage);
    setAgentChatDraftNowProviderForTests(() => new Date("2026-07-08T10:00:00.000Z"));

    try {
      setAgentChatDraft(identity, "task-1", buildDraft("one"));
      setAgentChatDraft(identity, "task-1", buildDraft("two"));
      setAgentChatDraft(identity, "task-1", buildDraft("three"));

      expect(setItem).not.toHaveBeenCalled();
      timers.runNextByDelay(1_000);
      await Promise.resolve();

      expect(setItem).toHaveBeenCalledTimes(1);
      const raw = storage.getItem(toAgentChatDraftStorageKey(identity));
      expect(raw).toContain("three");
    } finally {
      timers.restore();
    }
  });

  test("persists the latest draft when the max wait timer fires", async () => {
    const setItem = mock((_key: string, _value: string) => {});
    const storage = createMemoryStorage({ setItem });
    const timers = installManualTimers();
    setAgentChatDraftStorageForTests(storage);
    setAgentChatDraftNowProviderForTests(() => new Date("2026-07-08T10:00:00.000Z"));

    try {
      setAgentChatDraft(identity, "task-1", buildDraft("first"));
      setAgentChatDraft(identity, "task-1", buildDraft("latest"));

      timers.runNextByDelay(2_000);
      await Promise.resolve();

      expect(setItem).toHaveBeenCalledTimes(1);
      expect(storage.getItem(toAgentChatDraftStorageKey(identity))).toContain("latest");
    } finally {
      timers.restore();
    }
  });

  test("stages file-backed attachments asynchronously before durable persistence", async () => {
    const storage = createMemoryStorage();
    const stagedFile = new File(["pdf"], "brief.pdf", { type: "application/pdf" });
    setAgentChatDraftStorageForTests(storage);
    setAgentChatDraftNowProviderForTests(() => new Date("2026-07-08T10:00:00.000Z"));
    setAgentChatDraftAttachmentStagerForTests(mock(async () => "/tmp/staged/brief.pdf"));

    setAgentChatDraft(identity, "task-1", {
      segments: [createTextSegment("with file", "text-1")],
      attachments: [
        createComposerAttachment(
          {
            name: "brief.pdf",
            kind: "pdf",
            mime: "application/pdf",
            file: stagedFile,
          },
          "attachment-1",
        ),
      ],
    });

    await flushAgentChatDraft(identity);
    const raw = storage.getItem(toAgentChatDraftStorageKey(identity));
    expect(raw).toContain("/tmp/staged/brief.pdf");
    expect(raw).not.toContain("base64");
  });

  test("reuses a staged path for the same file attachment after later text edits", async () => {
    const storage = createMemoryStorage();
    const stagedFile = new File(["pdf"], "brief.pdf", { type: "application/pdf" });
    let stageCount = 0;
    const stager = mock(async () => {
      stageCount += 1;
      return `/tmp/staged/brief-${stageCount}.pdf`;
    });
    setAgentChatDraftStorageForTests(storage);
    setAgentChatDraftNowProviderForTests(() => new Date("2026-07-08T10:00:00.000Z"));
    setAgentChatDraftAttachmentStagerForTests(stager);

    const buildDraftWithFile = (text: string, file: File): AgentChatComposerDraft => ({
      segments: [createTextSegment(text, "text-1")],
      attachments: [
        createComposerAttachment(
          {
            name: "brief.pdf",
            kind: "pdf",
            mime: "application/pdf",
            file,
          },
          "attachment-1",
        ),
      ],
    });

    setAgentChatDraft(identity, "task-1", buildDraftWithFile("with file", stagedFile));
    await flushAgentChatDraft(identity);

    setAgentChatDraft(identity, "task-1", buildDraftWithFile("edited text", stagedFile));
    await flushAgentChatDraft(identity);

    const replacementFile = new File(["updated"], "brief.pdf", { type: "application/pdf" });
    setAgentChatDraft(identity, "task-1", buildDraftWithFile("replaced file", replacementFile));
    await flushAgentChatDraft(identity);

    const raw = storage.getItem(toAgentChatDraftStorageKey(identity));
    expect(stager).toHaveBeenCalledTimes(2);
    expect(raw).toContain("replaced file");
    expect(raw).toContain("/tmp/staged/brief-2.pdf");
    expect(raw).not.toContain("/tmp/staged/brief-3.pdf");
  });

  test("runs expired draft cleanup during first hydration only", () => {
    const storage = createMemoryStorage();
    const expiredIdentity = {
      workspaceId: "workspace",
      externalSessionId: "expired",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo",
    };
    const freshIdentity = {
      workspaceId: "workspace",
      externalSessionId: "fresh",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo",
    };
    setAgentChatDraftStorageForTests(storage);
    setAgentChatDraftNowProviderForTests(() => new Date("2026-07-08T10:00:00.000Z"));
    writeAgentChatDraftToStorage({
      storage,
      identity: expiredIdentity,
      taskId: "task-1",
      draft: buildDraft("expired"),
      updatedAt: "2026-07-01T09:59:59.000Z",
    });
    writeAgentChatDraftToStorage({
      storage,
      identity: freshIdentity,
      taskId: "task-2",
      draft: buildDraft("fresh"),
      updatedAt: "2026-07-08T09:00:00.000Z",
    });

    hydrateAgentChatDraft(freshIdentity, "task-2");
    hydrateAgentChatDraft(freshIdentity, "task-2");

    expect(storage.getItem(toAgentChatDraftStorageKey(expiredIdentity))).toBeNull();
    expect(storage.getItem(toAgentChatDraftStorageKey(freshIdentity))).not.toBeNull();
  });

  test("preserves stale storage and reports staging failures without dropping memory", async () => {
    const errors: Error[] = [];
    const storage = createMemoryStorage();
    const file = new File(["pdf"], "brief.pdf", { type: "application/pdf" });
    setAgentChatDraftStorageForTests(storage);
    setAgentChatDraftPersistenceErrorReporter((error) => {
      errors.push(error);
    });
    setAgentChatDraftAttachmentStagerForTests(
      mock(async () => {
        throw new Error("stage failed");
      }),
    );
    writeAgentChatDraftToStorage({
      storage,
      identity,
      taskId: "task-1",
      draft: buildDraft("old"),
      updatedAt: "2026-07-08T10:00:00.000Z",
    });

    setAgentChatDraft(identity, "task-1", {
      segments: [createTextSegment("with file", "text-1")],
      attachments: [
        createComposerAttachment(
          {
            name: "brief.pdf",
            kind: "pdf",
            mime: "application/pdf",
            file,
          },
          "attachment-1",
        ),
      ],
    });

    await flushAgentChatDraft(identity);

    expect(storage.getItem(toAgentChatDraftStorageKey(identity))).toContain("old");
    expect(errors[0]?.message).toBe("stage failed");
    expect(hydrateAgentChatDraft(identity, "task-1").attachments?.[0]?.file).toBe(file);
  });

  test("abandons in-flight staging when the draft entry is replaced", async () => {
    const storage = createMemoryStorage();
    const staging = createDeferred<string>();
    const stagedFile = new File(["pdf"], "brief.pdf", { type: "application/pdf" });
    const stager = mock(() => staging.promise);
    setAgentChatDraftStorageForTests(storage);
    setAgentChatDraftNowProviderForTests(() => new Date("2026-07-08T10:00:00.000Z"));
    setAgentChatDraftAttachmentStagerForTests(stager);

    setAgentChatDraft(identity, "task-1", {
      segments: [createTextSegment("with file", "text-1")],
      attachments: [
        createComposerAttachment(
          {
            name: "brief.pdf",
            kind: "pdf",
            mime: "application/pdf",
            file: stagedFile,
          },
          "attachment-1",
        ),
      ],
    });
    const staleFlush = flushAgentChatDraft(identity);
    await Promise.resolve();

    clearAgentChatDraft(identity);
    setAgentChatDraft(identity, "task-1", buildDraft("replacement"));
    staging.resolve("/tmp/staged/brief.pdf");
    await staleFlush;
    await flushAgentChatDraft(identity);

    const raw = storage.getItem(toAgentChatDraftStorageKey(identity));
    expect(stager).toHaveBeenCalledTimes(1);
    expect(raw).toContain("replacement");
    expect(raw).not.toContain("/tmp/staged/brief.pdf");
  });

  test("does not mark failed storage writes as persisted", async () => {
    const errors: Error[] = [];
    const setItem = mock((_key: string, _value: string) => {
      throw new Error("quota exceeded");
    });
    const storage = createMemoryStorage({ setItem });
    setAgentChatDraftStorageForTests(storage);
    setAgentChatDraftPersistenceErrorReporter((error) => {
      errors.push(error);
    });

    setAgentChatDraft(identity, "task-1", buildDraft("retry me"));
    await flushAgentChatDraft(identity);
    await flushAgentChatDraft(identity);

    expect(setItem).toHaveBeenCalledTimes(2);
    expect(errors.map((error) => error.message)).toEqual([
      expect.stringContaining("Failed to persist chat draft storage key"),
      expect.stringContaining("Failed to persist chat draft storage key"),
    ]);
  });

  test("does not mark oversized drafts as persisted", async () => {
    const errors: Error[] = [];
    const storage = createMemoryStorage();
    setAgentChatDraftStorageForTests(storage);
    setAgentChatDraftPersistenceErrorReporter((error) => {
      errors.push(error);
    });
    setAgentChatDraft(
      identity,
      "task-1",
      buildDraft("x".repeat(AGENT_CHAT_DRAFT_STORAGE_MAX_BYTES)),
    );

    await flushAgentChatDraft(identity);
    await flushAgentChatDraft(identity);

    expect(storage.getItem(toAgentChatDraftStorageKey(identity))).toBeNull();
    expect(errors.map((error) => error.message)).toEqual([
      expect.stringContaining("Chat draft is too large to persist"),
      expect.stringContaining("Chat draft is too large to persist"),
    ]);
  });

  test("keeps memory when throwing storage cleanup fails", () => {
    const storage = createMemoryStorage({
      removeItem: () => {
        throw new Error("remove failed");
      },
    });
    setAgentChatDraftStorageForTests(storage);
    setAgentChatDraft(identity, "task-1", buildDraft("keep me"));

    expect(() => clearAgentChatDraft(identity, { throwOnStorageError: true })).toThrow(
      "Failed to remove chat draft storage key",
    );

    expect(hydrateAgentChatDraft(identity, "task-1").segments[0]).toEqual(
      expect.objectContaining({ text: "keep me" }),
    );
  });

  test("clears storage only when the submitted draft version is still current", () => {
    const storage = createMemoryStorage();
    setAgentChatDraftStorageForTests(storage);
    const submittedVersion = setAgentChatDraft(identity, "task-1", buildDraft("submitted"));
    setAgentChatDraft(identity, "task-1", buildDraft("new draft"));

    const didClear = clearAgentChatDraft(identity, { onlyIfVersion: submittedVersion });

    expect(didClear).toBe(false);
    expect(hydrateAgentChatDraft(identity, "task-1").segments[0]).toEqual(
      expect.objectContaining({ text: "new draft" }),
    );
  });
});
