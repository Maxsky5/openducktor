import { describe, expect, test } from "bun:test";
import {
  agentRuntimeEventSchema,
  agentSessionTranscriptEventSchema,
  isAgentSessionTranscriptEventType,
} from "./agent-session-event-schemas";
import type { AgentSessionLiveRef } from "./agent-session-schemas";

const ref = {
  repoPath: "/repo",
  runtimeKind: "codex",
  workingDirectory: "/repo/worktree",
  externalSessionId: "thread-1",
} as const satisfies AgentSessionLiveRef;

describe("agent session transcript event contract", () => {
  const timestamp = "2026-07-16T10:00:00.000Z";
  const base = { externalSessionId: ref.externalSessionId, timestamp, sessionRef: ref };

  test("validates every existing normalized event variant", () => {
    const events = [
      { ...base, type: "session_started", message: "Started" },
      { ...base, type: "assistant_delta", channel: "text", delta: "hello" },
      { ...base, type: "assistant_message", messageId: "m1", message: "hello" },
      { ...base, type: "session_context_updated", totalTokens: 12 },
      {
        ...base,
        type: "user_message",
        messageId: "m2",
        message: "hello",
        parts: [{ kind: "text", text: "hello" }],
        state: "read",
      },
      {
        ...base,
        type: "assistant_part",
        part: {
          kind: "text",
          messageId: "m1",
          partId: "p1",
          text: "hello",
          completed: true,
        },
      },
      {
        ...base,
        type: "session_todos_updated",
        todos: [{ id: "todo-1", content: "Test", status: "pending", priority: "high" }],
      },
      { ...base, type: "session_compaction_started", message: "Compacting" },
      { ...base, type: "session_compacted", message: "Compacted" },
      {
        ...base,
        type: "approval_required",
        requestId: "native-1",
        requestInstanceId: "legacy-instance-1",
        requestType: "command_execution",
        title: "Run command",
      },
      { ...base, type: "approval_resolved", requestId: "native-1" },
      {
        ...base,
        type: "question_required",
        requestId: "native-2",
        questions: [{ header: "Choice", question: "Pick", options: [] }],
      },
      { ...base, type: "question_resolved", requestId: "native-2" },
      { ...base, type: "session_status", status: { type: "busy", message: null } },
      {
        ...base,
        type: "mcp_reconnect_started",
        serverName: "openducktor",
        workingDirectory: "/repo/worktree",
        status: "connecting",
      },
      { ...base, type: "session_error", message: "Failed" },
      { ...base, type: "session_idle" },
      { ...base, type: "session_finished", message: "Finished" },
    ] as const;

    for (const event of events) {
      expect(agentRuntimeEventSchema.parse(event)).toEqual(event);
    }
  });

  test("keeps retained projection state changes out of transcript envelopes", () => {
    const liveProjectionEvents = [
      { ...base, type: "session_context_updated", totalTokens: 12 },
      {
        ...base,
        type: "approval_required",
        requestId: "native-1",
        requestType: "command_execution",
        title: "Run command",
      },
      { ...base, type: "approval_resolved", requestId: "native-1" },
      {
        ...base,
        type: "question_required",
        requestId: "native-2",
        questions: [{ header: "Choice", question: "Pick", options: [] }],
      },
      { ...base, type: "question_resolved", requestId: "native-2" },
    ] as const;

    for (const event of liveProjectionEvents) {
      expect(agentRuntimeEventSchema.safeParse(event).success).toBe(true);
      expect(agentSessionTranscriptEventSchema.safeParse(event).success).toBe(false);
    }
  });

  test("classifies ordered transcript event types from the contract-owned list", () => {
    expect(isAgentSessionTranscriptEventType("assistant_message")).toBe(true);
    expect(isAgentSessionTranscriptEventType("session_finished")).toBe(true);
    expect(isAgentSessionTranscriptEventType("approval_required")).toBe(false);
    expect(isAgentSessionTranscriptEventType("session_context_updated")).toBe(false);
  });

  test("keeps lifecycle details on the ordered session stream", () => {
    const lifecycleEvents = [
      { ...base, type: "session_started", message: "Started" },
      {
        ...base,
        type: "session_status",
        status: { type: "retry", attempt: 2, message: "Busy", nextEpochMs: 123 },
      },
      { ...base, type: "session_error", message: "Failed" },
      { ...base, type: "session_idle" },
      { ...base, type: "session_finished", message: "Finished" },
    ] as const;

    for (const event of lifecycleEvents) {
      expect(agentSessionTranscriptEventSchema.parse(event)).toEqual(event);
    }
  });

  test("rejects unnormalized transcript events and unknown native payload fields", () => {
    expect(
      agentSessionTranscriptEventSchema.safeParse({
        type: "assistant_delta",
        externalSessionId: ref.externalSessionId,
        timestamp: base.timestamp,
        channel: "text",
        delta: "missing ref",
      }).success,
    ).toBe(false);
    expect(
      agentSessionTranscriptEventSchema.safeParse({
        ...base,
        type: "thread/tokenUsage/updated",
        params: { threadId: "thread-1" },
      }).success,
    ).toBe(false);
    expect(
      agentSessionTranscriptEventSchema.safeParse({
        ...base,
        type: "session_idle",
        runtimeId: "runtime-private",
      }).success,
    ).toBe(false);
  });
});
