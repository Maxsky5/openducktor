import { describe, expect, test } from "bun:test";
import type { AgentSessionRuntimeRef, ResumeAgentSessionInput } from "@openducktor/core";
import {
  clearLocalSessionState,
  sessionStateFromThreadRestore,
  sessionStateFromThreadResume,
} from "./codex-session-lifecycle";
import type { CodexThreadResumeResult } from "./types";

const threadResumeResponse: CodexThreadResumeResult = {
  thread: {
    id: "thread-1",
    cwd: "/repo",
    createdAt: 1_778_112_000,
    preview: "Existing Codex session",
    status: { type: "active", activeFlags: [] },
  },
};

describe("codex session lifecycle", () => {
  test("keeps restore state free of local live status", () => {
    const sharedInput = {
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "planner",
      systemPrompt: "Follow the plan.",
      externalSessionId: "thread-1",
    } satisfies ResumeAgentSessionInput;
    const model = { providerId: "openai", modelId: "gpt-5", variant: "medium" } as const;

    const resumed = sessionStateFromThreadResume(
      sharedInput,
      "runtime-1",
      model,
      threadResumeResponse,
    );
    const restored = sessionStateFromThreadRestore(
      sharedInput satisfies AgentSessionRuntimeRef,
      "runtime-1",
      model,
      threadResumeResponse,
    );

    expect(resumed).toMatchObject({
      role: "planner",
      runtimeId: "runtime-1",
      repoPath: "/repo",
      threadId: "thread-1",
      workingDirectory: "/repo",
      taskId: "task-1",
      model,
      summary: {
        externalSessionId: "thread-1",
        role: "planner",
        status: "running",
      },
      liveStatus: {
        classification: "running",
        status: { type: "busy" },
        agentSessionStatus: "running",
      },
    });
    expect(restored).toMatchObject({
      role: "planner",
      runtimeId: "runtime-1",
      repoPath: "/repo",
      threadId: "thread-1",
      workingDirectory: "/repo",
      taskId: "task-1",
      model,
      summary: {
        externalSessionId: "thread-1",
        role: "planner",
        status: "running",
      },
    });
    expect(restored.liveStatus).toBeUndefined();
  });

  test("preserves restore-specific optional model absence", () => {
    const input = {
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "qa",
      systemPrompt: "Review the work.",
      externalSessionId: "thread-1",
    } satisfies AgentSessionRuntimeRef;

    const restored = sessionStateFromThreadRestore(input, "runtime-1", undefined, {
      ...threadResumeResponse,
      startedAt: "2026-05-07T00:00:00.000Z",
    });

    expect(restored.model).toBeUndefined();
    expect(restored.summary.startedAt).toBe("2026-05-07T00:00:00.000Z");
    expect(restored.liveStatus).toBeUndefined();
  });

  test("clears local session-scoped state without touching other sessions", () => {
    const clearedSessionEvents: string[] = [];
    const clearedPendingInput: string[] = [];
    const store = {
      sessions: new Map([
        ["thread-1", {}],
        ["thread-2", {}],
      ]),
      sessionEvents: {
        clear: (externalSessionId: string) => clearedSessionEvents.push(externalSessionId),
      },
      bufferedNotificationsByThreadId: new Map([
        ["thread-1", []],
        ["thread-2", []],
      ]),
      bufferedServerRequestsByThreadId: new Map([
        ["thread-1", []],
        ["thread-2", []],
      ]),
      handledStreamRequestKeysByThreadId: new Map([
        ["thread-1", new Set()],
        ["thread-2", new Set()],
      ]),
      syntheticUserMessageTextsByThreadId: new Map([
        ["thread-1", []],
        ["thread-2", []],
      ]),
      latestTodosBySessionId: new Map([
        ["thread-1", []],
        ["thread-2", []],
      ]),
      activeTurnsBySessionId: new Map([
        ["thread-1", {}],
        ["thread-2", {}],
      ]),
      pendingInput: {
        clearSession: (externalSessionId: string) => clearedPendingInput.push(externalSessionId),
      },
      completedAgentMessagesByTurnKey: new Map([
        ["thread-1:turn-1", {}],
        ["thread-2:turn-1", {}],
      ]),
      tokenUsageByTurnKey: new Map([
        ["thread-1:turn-1", {}],
        ["thread-2:turn-1", {}],
      ]),
      modelByTurnKey: new Map([
        ["thread-1:turn-1", {}],
        ["thread-2:turn-1", {}],
      ]),
    };

    clearLocalSessionState(store, "thread-1");

    expect(store.sessions.has("thread-1")).toBe(false);
    expect(store.sessions.has("thread-2")).toBe(true);
    expect(clearedSessionEvents).toEqual(["thread-1"]);
    expect(store.bufferedNotificationsByThreadId.has("thread-1")).toBe(false);
    expect(store.bufferedNotificationsByThreadId.has("thread-2")).toBe(true);
    expect(store.bufferedServerRequestsByThreadId.has("thread-1")).toBe(false);
    expect(store.bufferedServerRequestsByThreadId.has("thread-2")).toBe(true);
    expect(store.handledStreamRequestKeysByThreadId.has("thread-1")).toBe(false);
    expect(store.handledStreamRequestKeysByThreadId.has("thread-2")).toBe(true);
    expect(store.syntheticUserMessageTextsByThreadId.has("thread-1")).toBe(false);
    expect(store.syntheticUserMessageTextsByThreadId.has("thread-2")).toBe(true);
    expect(store.latestTodosBySessionId.has("thread-1")).toBe(false);
    expect(store.latestTodosBySessionId.has("thread-2")).toBe(true);
    expect(store.activeTurnsBySessionId.has("thread-1")).toBe(false);
    expect(store.activeTurnsBySessionId.has("thread-2")).toBe(true);
    expect(clearedPendingInput).toEqual(["thread-1"]);
    expect(store.completedAgentMessagesByTurnKey.has("thread-1:turn-1")).toBe(false);
    expect(store.completedAgentMessagesByTurnKey.has("thread-2:turn-1")).toBe(true);
    expect(store.tokenUsageByTurnKey.has("thread-1:turn-1")).toBe(false);
    expect(store.tokenUsageByTurnKey.has("thread-2:turn-1")).toBe(true);
    expect(store.modelByTurnKey.has("thread-1:turn-1")).toBe(false);
    expect(store.modelByTurnKey.has("thread-2:turn-1")).toBe(true);
  });

  test("clears missing local sessions without throwing", () => {
    const mockClearSessionEvents = () => undefined;
    const mockClearPendingInput = () => undefined;
    const store = {
      sessions: new Map([["thread-2", {}]]),
      sessionEvents: { clear: mockClearSessionEvents },
      bufferedNotificationsByThreadId: new Map([["thread-2", []]]),
      bufferedServerRequestsByThreadId: new Map([["thread-2", []]]),
      handledStreamRequestKeysByThreadId: new Map([["thread-2", new Set()]]),
      syntheticUserMessageTextsByThreadId: new Map([["thread-2", []]]),
      latestTodosBySessionId: new Map([["thread-2", []]]),
      activeTurnsBySessionId: new Map([["thread-2", {}]]),
      pendingInput: { clearSession: mockClearPendingInput },
      completedAgentMessagesByTurnKey: new Map([["thread-2:turn-1", {}]]),
      tokenUsageByTurnKey: new Map([["thread-2:turn-1", {}]]),
      modelByTurnKey: new Map([["thread-2:turn-1", {}]]),
    };

    expect(() => clearLocalSessionState(store, "missing-thread")).not.toThrow();

    expect(store.sessions.has("thread-2")).toBe(true);
    expect(store.completedAgentMessagesByTurnKey.has("thread-2:turn-1")).toBe(true);
  });
});
