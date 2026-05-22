import { describe, expect, test } from "bun:test";
import type { AttachAgentSessionInput, ResumeAgentSessionInput } from "@openducktor/core";
import {
  clearLocalSessionState,
  sessionStateFromThreadAttach,
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
  test("builds equivalent session state for resume and attach responses", () => {
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
    const attached = sessionStateFromThreadAttach(
      sharedInput satisfies AttachAgentSessionInput,
      "runtime-1",
      model,
      threadResumeResponse,
    );

    expect(attached).toEqual(resumed);
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
  });

  test("preserves attach-specific optional model absence", () => {
    const input = {
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      taskId: "task-1",
      role: "qa",
      systemPrompt: "Review the work.",
      externalSessionId: "thread-1",
    } satisfies AttachAgentSessionInput;

    const attached = sessionStateFromThreadAttach(input, "runtime-1", undefined, {
      ...threadResumeResponse,
      startedAt: "2026-05-07T00:00:00.000Z",
    });

    expect(attached.model).toBeUndefined();
    expect(attached.summary.startedAt).toBe("2026-05-07T00:00:00.000Z");
    expect(attached.liveStatus?.agentSessionStatus).toBe("running");
  });

  test("clears local session-scoped state without touching other sessions", () => {
    const store = {
      sessions: new Map([
        ["thread-1", {}],
        ["thread-2", {}],
      ]),
      listenersBySessionId: new Map([
        ["thread-1", new Set()],
        ["thread-2", new Set()],
      ]),
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
      eventBacklogBySessionId: new Map([
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
      pendingApprovalIdsBySessionId: new Map([["thread-1", new Set(["approval-1"])]]),
      pendingApprovalsByRequestId: new Map([
        ["approval-1", {}],
        ["approval-other", {}],
      ]),
      activeTurnsByApprovalRequestId: new Map([["approval-1", {}]]),
      pendingQuestionIdsBySessionId: new Map([["thread-1", new Set(["question-1"])]]),
      pendingQuestionsByRequestId: new Map([
        ["question-1", {}],
        ["question-other", {}],
      ]),
      activeTurnsByQuestionRequestId: new Map([["question-1", {}]]),
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
    expect(store.listenersBySessionId.has("thread-1")).toBe(false);
    expect(store.listenersBySessionId.has("thread-2")).toBe(true);
    expect(store.bufferedNotificationsByThreadId.has("thread-1")).toBe(false);
    expect(store.bufferedNotificationsByThreadId.has("thread-2")).toBe(true);
    expect(store.bufferedServerRequestsByThreadId.has("thread-1")).toBe(false);
    expect(store.bufferedServerRequestsByThreadId.has("thread-2")).toBe(true);
    expect(store.handledStreamRequestKeysByThreadId.has("thread-1")).toBe(false);
    expect(store.handledStreamRequestKeysByThreadId.has("thread-2")).toBe(true);
    expect(store.syntheticUserMessageTextsByThreadId.has("thread-1")).toBe(false);
    expect(store.syntheticUserMessageTextsByThreadId.has("thread-2")).toBe(true);
    expect(store.eventBacklogBySessionId.has("thread-1")).toBe(false);
    expect(store.eventBacklogBySessionId.has("thread-2")).toBe(true);
    expect(store.latestTodosBySessionId.has("thread-1")).toBe(false);
    expect(store.latestTodosBySessionId.has("thread-2")).toBe(true);
    expect(store.activeTurnsBySessionId.has("thread-1")).toBe(false);
    expect(store.activeTurnsBySessionId.has("thread-2")).toBe(true);
    expect(store.pendingApprovalIdsBySessionId.has("thread-1")).toBe(false);
    expect(store.pendingApprovalsByRequestId.has("approval-1")).toBe(false);
    expect(store.pendingApprovalsByRequestId.has("approval-other")).toBe(true);
    expect(store.activeTurnsByApprovalRequestId.has("approval-1")).toBe(false);
    expect(store.pendingQuestionIdsBySessionId.has("thread-1")).toBe(false);
    expect(store.pendingQuestionsByRequestId.has("question-1")).toBe(false);
    expect(store.pendingQuestionsByRequestId.has("question-other")).toBe(true);
    expect(store.activeTurnsByQuestionRequestId.has("question-1")).toBe(false);
    expect(store.completedAgentMessagesByTurnKey.has("thread-1:turn-1")).toBe(false);
    expect(store.completedAgentMessagesByTurnKey.has("thread-2:turn-1")).toBe(true);
    expect(store.tokenUsageByTurnKey.has("thread-1:turn-1")).toBe(false);
    expect(store.tokenUsageByTurnKey.has("thread-2:turn-1")).toBe(true);
    expect(store.modelByTurnKey.has("thread-1:turn-1")).toBe(false);
    expect(store.modelByTurnKey.has("thread-2:turn-1")).toBe(true);
  });

  test("clears missing local sessions without throwing", () => {
    const store = {
      sessions: new Map([["thread-2", {}]]),
      listenersBySessionId: new Map([["thread-2", new Set()]]),
      bufferedNotificationsByThreadId: new Map([["thread-2", []]]),
      bufferedServerRequestsByThreadId: new Map([["thread-2", []]]),
      handledStreamRequestKeysByThreadId: new Map([["thread-2", new Set()]]),
      syntheticUserMessageTextsByThreadId: new Map([["thread-2", []]]),
      eventBacklogBySessionId: new Map([["thread-2", []]]),
      latestTodosBySessionId: new Map([["thread-2", []]]),
      activeTurnsBySessionId: new Map([["thread-2", {}]]),
      pendingApprovalIdsBySessionId: new Map([["thread-2", new Set(["approval-2"])]]),
      pendingApprovalsByRequestId: new Map([["approval-2", {}]]),
      activeTurnsByApprovalRequestId: new Map([["approval-2", {}]]),
      pendingQuestionIdsBySessionId: new Map([["thread-2", new Set(["question-2"])]]),
      pendingQuestionsByRequestId: new Map([["question-2", {}]]),
      activeTurnsByQuestionRequestId: new Map([["question-2", {}]]),
      completedAgentMessagesByTurnKey: new Map([["thread-2:turn-1", {}]]),
      tokenUsageByTurnKey: new Map([["thread-2:turn-1", {}]]),
      modelByTurnKey: new Map([["thread-2:turn-1", {}]]),
    };

    expect(() => clearLocalSessionState(store, "missing-thread")).not.toThrow();

    expect(store.sessions.has("thread-2")).toBe(true);
    expect(store.pendingApprovalsByRequestId.has("approval-2")).toBe(true);
    expect(store.pendingQuestionsByRequestId.has("question-2")).toBe(true);
    expect(store.completedAgentMessagesByTurnKey.has("thread-2:turn-1")).toBe(true);
  });
});
