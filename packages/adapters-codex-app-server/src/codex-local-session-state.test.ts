import { describe, expect, test } from "bun:test";
import { CodexLocalSessionState } from "./codex-local-session-state";
import type { CodexSessionState } from "./types";

const session = (threadId: string, runtimeId = "runtime-1"): CodexSessionState => ({
  summary: {
    externalSessionId: threadId,
    title: threadId,
    status: "running",
    role: "build",
    startedAt: "2026-06-13T00:00:00.000Z",
  },
  systemPrompt: "",
  role: "build",
  runtimeId,
  repoPath: "/repo",
  threadId,
  workingDirectory: "/repo",
  taskId: "task-1",
});

const createStore = () => {
  const clearedSessionEvents: string[] = [];
  const clearedPendingInput: string[] = [];
  const clearedRuntimeEvents: string[] = [];
  const clearedReadOnlyHistoryLoads: string[] = [];
  const drainedRuntimeEvents: string[] = [];
  const stoppedRuntimeSubscriptions: string[] = [];
  const activeTurnsBySessionId = new Map<string, unknown>();
  const store = new CodexLocalSessionState({
    sessionEvents: {
      clear: (externalSessionId) => clearedSessionEvents.push(externalSessionId),
    },
    activeTurnsBySessionId,
    pendingInput: {
      clearSession: (externalSessionId) => clearedPendingInput.push(externalSessionId),
    },
    threadInventory: {
      clearReadOnlyHistoryLoad: (externalSessionId) =>
        clearedReadOnlyHistoryLoads.push(externalSessionId),
    },
    runtimeEvents: {
      clearSession: (externalSessionId) => clearedRuntimeEvents.push(externalSessionId),
      drainBufferedStreamEvents: async (externalSessionId) => {
        drainedRuntimeEvents.push(externalSessionId);
      },
      stopRuntimeEventSubscription: (runtimeId) => stoppedRuntimeSubscriptions.push(runtimeId),
    },
  });
  return {
    store,
    activeTurnsBySessionId,
    clearedSessionEvents,
    clearedPendingInput,
    clearedRuntimeEvents,
    clearedReadOnlyHistoryLoads,
    drainedRuntimeEvents,
    stoppedRuntimeSubscriptions,
  };
};

describe("CodexLocalSessionState", () => {
  test("remembers sessions and drains buffered runtime events", async () => {
    const { store, clearedReadOnlyHistoryLoads, drainedRuntimeEvents } = createStore();
    store.remember(session("thread-1", "runtime-1"));
    store.remember(session("thread-2", "runtime-2"));
    await Promise.resolve();

    expect(store.get("thread-1")?.runtimeId).toBe("runtime-1");
    expect(store.has("thread-2")).toBe(true);
    expect([...store.values()].map((entry) => entry.threadId)).toEqual(["thread-1", "thread-2"]);
    expect(clearedReadOnlyHistoryLoads).toEqual(["thread-1", "thread-2"]);
    expect(drainedRuntimeEvents).toEqual(["thread-1", "thread-2"]);
  });

  test("clears local session-scoped state without touching other sessions", () => {
    const {
      store,
      activeTurnsBySessionId,
      clearedSessionEvents,
      clearedPendingInput,
      clearedRuntimeEvents,
      stoppedRuntimeSubscriptions,
    } = createStore();
    store.remember(session("thread-1"));
    store.remember(session("thread-2"));
    activeTurnsBySessionId.set("thread-1", {});
    activeTurnsBySessionId.set("thread-2", {});

    const cleared = store.release("thread-1");

    expect(cleared?.threadId).toBe("thread-1");
    expect(store.has("thread-1")).toBe(false);
    expect(store.has("thread-2")).toBe(true);
    expect(activeTurnsBySessionId.has("thread-1")).toBe(false);
    expect(activeTurnsBySessionId.has("thread-2")).toBe(true);
    expect(clearedSessionEvents).toEqual(["thread-1"]);
    expect(clearedPendingInput).toEqual(["thread-1"]);
    expect(clearedRuntimeEvents).toEqual(["thread-1"]);
    expect(stoppedRuntimeSubscriptions).toEqual([]);
  });

  test("stops runtime subscription when the last local session for a runtime is released", () => {
    const { store, stoppedRuntimeSubscriptions } = createStore();
    store.remember(session("thread-1", "runtime-1"));
    store.remember(session("thread-2", "runtime-2"));

    store.release("thread-1");

    expect(stoppedRuntimeSubscriptions).toEqual(["runtime-1"]);
  });

  test("clears missing local sessions without throwing", () => {
    const { store, activeTurnsBySessionId, stoppedRuntimeSubscriptions } = createStore();
    store.remember(session("thread-2"));
    activeTurnsBySessionId.set("thread-2", {});

    expect(store.release("missing-thread")).toBeUndefined();

    expect(store.has("thread-2")).toBe(true);
    expect(activeTurnsBySessionId.has("thread-2")).toBe(true);
    expect(stoppedRuntimeSubscriptions).toEqual([]);
  });
});
