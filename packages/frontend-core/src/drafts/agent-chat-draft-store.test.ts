import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ScheduleTask } from "../lib/scheduling";
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
import type { ClientStorage } from "../platform/client-storage";
import type { AttachmentStager } from "../platform/device-file";
import {
  type AgentChatDraftStore,
  type AgentChatDraftStoreOptions,
  ChatDraftTooLargeError,
  createAgentChatDraftStore,
} from "./agent-chat-draft-store";

type TestStorage = ClientStorage;

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

const createManualScheduler = () => {
  const scheduledTasks: Array<{ callback: () => void; delayMs: number; cancelled: boolean }> = [];
  const scheduleTask: ScheduleTask = (callback, delayMs) => {
    const task = { callback, delayMs, cancelled: false };
    scheduledTasks.push(task);
    return () => {
      task.cancelled = true;
    };
  };

  return {
    scheduleTask,
    runNextByDelay: (delayMs: number) => {
      const task = scheduledTasks.find(
        (candidate) => candidate.delayMs === delayMs && !candidate.cancelled,
      );
      if (!task) {
        throw new Error(`Expected scheduled task with delay ${delayMs}`);
      }
      task.cancelled = true;
      task.callback();
    },
  };
};

const createDeferred = <T>() => {
  let resolveValue: (value: T) => void = () => {};
  let rejectValue: (cause: unknown) => void = () => {};
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

const createdStores: AgentChatDraftStore[] = [];

const noAttachmentStager: AttachmentStager = async (file) => {
  throw new Error(`This test cannot stage '${file.name}'.`);
};

const createStore = (
  options: Partial<AgentChatDraftStoreOptions> & Pick<AgentChatDraftStoreOptions, "storage">,
): AgentChatDraftStore => {
  const store = createAgentChatDraftStore({ stageAttachment: noAttachmentStager, ...options });
  createdStores.push(store);
  return store;
};

afterEach(() => {
  for (const store of createdStores.splice(0)) {
    store.dispose();
  }
});

describe("agent chat draft store", () => {
  test("restores workspace chat text from storage after memory is reset", async () => {
    const storage = createMemoryStorage();
    const workspaceIdentity = { workspaceId: "workspace", workspaceSessionId: "saved-chat" };
    const draft = buildDraft("Unsent workspace chat");
    const firstStore = createStore({ storage });
    firstStore.set(workspaceIdentity, null, draft);
    await firstStore.flush(workspaceIdentity);
    expect(storage.getItem(toAgentChatDraftStorageKey(workspaceIdentity))).not.toBeNull();
    firstStore.dispose();
    const store = createStore({ storage });
    expect(store.hydrate(workspaceIdentity, null)).toEqual(draft);
    store.clear(workspaceIdentity);
    expect(storage.getItem(toAgentChatDraftStorageKey(workspaceIdentity))).toBeNull();
  });
  test("hydrates a session from storage once and then reads from memory", () => {
    const getItem = mock((_key: string) => {});
    const storage = createMemoryStorage({ getItem });
    writeAgentChatDraftToStorage({
      storage,
      identity,
      taskId: "task-1",
      draft: buildDraft("persisted"),
      updatedAt: "2026-07-08T10:00:00.000Z",
    });
    const store = createStore({ storage, now: () => new Date("2026-07-08T10:00:01.000Z") });

    const firstHydration = store.hydrate(identity, "task-1");
    const getItemCallsAfterFirstHydration = getItem.mock.calls.length;
    const secondHydration = store.hydrate(identity, "task-1");

    expect(firstHydration.segments).toEqual(secondHydration.segments);
    expect(getItem.mock.calls.length).toBe(getItemCallsAfterFirstHydration);
  });

  test("coalesces dirty writes instead of writing on every draft change", async () => {
    const setItem = mock((_key: string, _value: string) => {});
    const storage = createMemoryStorage({ setItem });
    const scheduler = createManualScheduler();
    const store = createStore({
      storage,
      scheduleTask: scheduler.scheduleTask,
      now: () => new Date("2026-07-08T10:00:00.000Z"),
    });

    store.set(identity, "task-1", buildDraft("one"));
    store.set(identity, "task-1", buildDraft("two"));
    store.set(identity, "task-1", buildDraft("three"));

    expect(setItem).not.toHaveBeenCalled();
    scheduler.runNextByDelay(1_000);
    await Promise.resolve();

    expect(setItem).toHaveBeenCalledTimes(1);
    const raw = storage.getItem(toAgentChatDraftStorageKey(identity));
    expect(raw).toContain("three");
  });

  test("persists the latest draft when the max wait timer fires", async () => {
    const setItem = mock((_key: string, _value: string) => {});
    const storage = createMemoryStorage({ setItem });
    const scheduler = createManualScheduler();
    const store = createStore({
      storage,
      scheduleTask: scheduler.scheduleTask,
      now: () => new Date("2026-07-08T10:00:00.000Z"),
    });

    store.set(identity, "task-1", buildDraft("first"));
    store.set(identity, "task-1", buildDraft("latest"));

    scheduler.runNextByDelay(2_000);
    await Promise.resolve();

    expect(setItem).toHaveBeenCalledTimes(1);
    expect(storage.getItem(toAgentChatDraftStorageKey(identity))).toContain("latest");
  });

  test("stages file-backed attachments asynchronously before durable persistence", async () => {
    const storage = createMemoryStorage();
    const stagedFile = new File(["pdf"], "brief.pdf", { type: "application/pdf" });
    const store = createStore({
      storage,
      now: () => new Date("2026-07-08T10:00:00.000Z"),
      stageAttachment: mock(async () => "/tmp/staged/brief.pdf"),
    });

    store.set(identity, "task-1", {
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

    await store.flush(identity);
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
    const store = createStore({
      storage,
      now: () => new Date("2026-07-08T10:00:00.000Z"),
      stageAttachment: stager,
    });

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

    store.set(identity, "task-1", buildDraftWithFile("with file", stagedFile));
    await store.flush(identity);

    store.set(identity, "task-1", buildDraftWithFile("edited text", stagedFile));
    await store.flush(identity);

    const replacementFile = new File(["updated"], "brief.pdf", { type: "application/pdf" });
    store.set(identity, "task-1", buildDraftWithFile("replaced file", replacementFile));
    await store.flush(identity);

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
    const store = createStore({ storage, now: () => new Date("2026-07-08T10:00:00.000Z") });
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

    store.hydrate(freshIdentity, "task-2");
    store.hydrate(freshIdentity, "task-2");

    expect(storage.getItem(toAgentChatDraftStorageKey(expiredIdentity))).toBeNull();
    expect(storage.getItem(toAgentChatDraftStorageKey(freshIdentity))).not.toBeNull();
  });

  test("preserves stale storage and reports staging failures without dropping memory", async () => {
    const errors: Error[] = [];
    const storage = createMemoryStorage();
    const file = new File(["pdf"], "brief.pdf", { type: "application/pdf" });
    const store = createStore({
      storage,
      stageAttachment: mock(async () => {
        throw new Error("stage failed");
      }),
      reportPersistenceError: (error) => {
        errors.push(error);
      },
    });
    writeAgentChatDraftToStorage({
      storage,
      identity,
      taskId: "task-1",
      draft: buildDraft("old"),
      updatedAt: "2026-07-08T10:00:00.000Z",
    });

    store.set(identity, "task-1", {
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

    await store.flush(identity);

    expect(storage.getItem(toAgentChatDraftStorageKey(identity))).toContain("old");
    expect(errors[0]?.message).toBe("stage failed");
    expect(store.hydrate(identity, "task-1").attachments?.[0]?.file).toBe(file);
  });

  test("abandons in-flight staging when the draft entry is replaced", async () => {
    const storage = createMemoryStorage();
    const staging = createDeferred<string>();
    const stagedFile = new File(["pdf"], "brief.pdf", { type: "application/pdf" });
    const stager = mock(() => staging.promise);
    const store = createStore({
      storage,
      now: () => new Date("2026-07-08T10:00:00.000Z"),
      stageAttachment: stager,
    });

    store.set(identity, "task-1", {
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
    const staleFlush = store.flush(identity);
    await Promise.resolve();

    store.clear(identity);
    store.set(identity, "task-1", buildDraft("replacement"));
    staging.resolve("/tmp/staged/brief.pdf");
    await staleFlush;
    await store.flush(identity);

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
    const store = createStore({
      storage,
      reportPersistenceError: (error) => {
        errors.push(error);
      },
    });

    store.set(identity, "task-1", buildDraft("retry me"));
    await store.flush(identity);
    await store.flush(identity);

    expect(setItem).toHaveBeenCalledTimes(2);
    expect(errors.map((error) => error.message)).toEqual([
      expect.stringContaining("Failed to persist chat draft storage key"),
      expect.stringContaining("Failed to persist chat draft storage key"),
    ]);
  });

  test("saveAll reports a failed write and keeps the unsaved draft", async () => {
    let failWrites = true;
    const storage = createMemoryStorage({
      setItem: () => {
        if (failWrites) throw new Error("quota exceeded");
      },
    });
    const store = createStore({ storage, reportPersistenceError: () => {} });
    store.set(identity, "task-1", buildDraft("keep me"));

    await expect(store.saveAll()).rejects.toThrow("Could not save a chat draft.");
    store.dispose();

    expect(store.readVersion(identity)).not.toBeNull();
    failWrites = false;
    await store.saveAll();
    expect(storage.getItem(toAgentChatDraftStorageKey(identity))).not.toBeNull();
  });

  test("does not mark oversized drafts as persisted", async () => {
    const errors: Error[] = [];
    const storage = createMemoryStorage();
    const store = createStore({
      storage,
      reportPersistenceError: (error) => {
        errors.push(error);
      },
    });
    store.set(identity, "task-1", buildDraft("x".repeat(AGENT_CHAT_DRAFT_STORAGE_MAX_BYTES)));

    await store.flush(identity);
    await store.flush(identity);

    expect(storage.getItem(toAgentChatDraftStorageKey(identity))).toBeNull();
    expect(errors).toHaveLength(2);
    for (const error of errors) {
      expect(error).toBeInstanceOf(ChatDraftTooLargeError);
      expect(error.message).toContain("This chat draft is too long to keep on this device");
    }
    expect(store.hydrate(identity, "task-1")).toEqual(
      buildDraft("x".repeat(AGENT_CHAT_DRAFT_STORAGE_MAX_BYTES)),
    );
  });

  test("keeps memory when throwing storage cleanup fails", () => {
    const storage = createMemoryStorage({
      removeItem: () => {
        throw new Error("remove failed");
      },
    });
    const store = createStore({ storage });
    store.set(identity, "task-1", buildDraft("keep me"));

    expect(() => store.clear(identity, { throwOnStorageError: true })).toThrow(
      "Failed to remove chat draft storage key",
    );

    expect(store.hydrate(identity, "task-1").segments[0]).toEqual(
      expect.objectContaining({ text: "keep me" }),
    );
  });

  test("clears storage only when the submitted draft version is still current", () => {
    const storage = createMemoryStorage();
    const store = createStore({ storage });
    const submittedVersion = store.set(identity, "task-1", buildDraft("submitted"));
    store.set(identity, "task-1", buildDraft("new draft"));

    const didClear = store.clear(identity, { onlyIfVersion: submittedVersion });

    expect(didClear).toBe(false);
    expect(store.hydrate(identity, "task-1").segments[0]).toEqual(
      expect.objectContaining({ text: "new draft" }),
    );
  });
});
