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
  const sessions = new Map<string, CodexSessionState>();
  const activeTurnsBySessionId = new Map<string, unknown>();
  const store = new CodexLocalSessionState({
    sessions,
    sessionEvents: {
      clear: (externalSessionId) => clearedSessionEvents.push(externalSessionId),
    },
    activeTurnsBySessionId,
    pendingInput: {
      clearSession: (externalSessionId) => clearedPendingInput.push(externalSessionId),
    },
    runtimeEvents: {
      clearSession: (externalSessionId) => clearedRuntimeEvents.push(externalSessionId),
    },
  });
  return {
    store,
    sessions,
    activeTurnsBySessionId,
    clearedSessionEvents,
    clearedPendingInput,
    clearedRuntimeEvents,
  };
};

describe("CodexLocalSessionState", () => {
  test("stores sessions and reports runtime ownership", () => {
    const { store } = createStore();
    store.set(session("thread-1", "runtime-1"));
    store.set(session("thread-2", "runtime-2"));

    expect(store.get("thread-1")?.runtimeId).toBe("runtime-1");
    expect(store.has("thread-2")).toBe(true);
    expect([...store.values()].map((entry) => entry.threadId)).toEqual(["thread-1", "thread-2"]);
    expect(store.hasRuntimeSession("runtime-1")).toBe(true);
    expect(store.hasRuntimeSession("missing-runtime")).toBe(false);
  });

  test("clears local session-scoped state without touching other sessions", () => {
    const {
      store,
      sessions,
      activeTurnsBySessionId,
      clearedSessionEvents,
      clearedPendingInput,
      clearedRuntimeEvents,
    } = createStore();
    store.set(session("thread-1"));
    store.set(session("thread-2"));
    activeTurnsBySessionId.set("thread-1", {});
    activeTurnsBySessionId.set("thread-2", {});

    const cleared = store.clear("thread-1");

    expect(cleared?.threadId).toBe("thread-1");
    expect(sessions.has("thread-1")).toBe(false);
    expect(sessions.has("thread-2")).toBe(true);
    expect(activeTurnsBySessionId.has("thread-1")).toBe(false);
    expect(activeTurnsBySessionId.has("thread-2")).toBe(true);
    expect(clearedSessionEvents).toEqual(["thread-1"]);
    expect(clearedPendingInput).toEqual(["thread-1"]);
    expect(clearedRuntimeEvents).toEqual(["thread-1"]);
  });

  test("clears missing local sessions without throwing", () => {
    const { store, sessions, activeTurnsBySessionId } = createStore();
    store.set(session("thread-2"));
    activeTurnsBySessionId.set("thread-2", {});

    expect(store.clear("missing-thread")).toBeUndefined();

    expect(sessions.has("thread-2")).toBe(true);
    expect(activeTurnsBySessionId.has("thread-2")).toBe(true);
  });
});
