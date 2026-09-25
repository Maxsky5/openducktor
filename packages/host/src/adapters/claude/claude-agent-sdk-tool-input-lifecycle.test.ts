import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@openducktor/core";
import { Effect } from "effect";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession } from "./claude-agent-sdk-events.test-support";
import { consumeClaudeSession } from "./claude-agent-sdk-session-io";
import {
  claudeQueryWithMessages,
  createClaudeSession,
  ignoreClaudeBackgroundFailure,
} from "./claude-agent-sdk-session-io.test-support";
import { createClaudeAgentSdkSessionStore } from "./claude-agent-sdk-session-store";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";
import {
  completeClaudeStreamToolInput,
  consumeClaudeStreamEmittedToolInput,
} from "./claude-agent-sdk-tool-input-stream";
import { claudeSessionRef } from "./claude-agent-sdk-utils";

const start = claudeSdkMessageFixture({
  type: "stream_event",
  event: {
    type: "content_block_start",
    index: 0,
    content_block: { type: "tool_use", id: "write-1", name: "Write", input: {} },
  },
});
const delta = claudeSdkMessageFixture({
  type: "stream_event",
  event: {
    type: "content_block_delta",
    index: 0,
    delta: { type: "input_json_delta", partial_json: '{"content":' },
  },
});
const stop = claudeSdkMessageFixture({
  type: "stream_event",
  event: { type: "content_block_stop", index: 0 },
});
const timestamp = "2026-09-08T00:00:00.000Z";
const modelSelection = (model: string) => ({
  providerId: "claude",
  modelId: model,
  runtimeKind: "claude" as const,
});

describe("Claude tool input lifecycle", () => {
  test("reports malformed completed input through the session error path and closes the stream", async () => {
    const events: AgentEvent[] = [];
    const session = createClaudeSession({ query: claudeQueryWithMessages([start, delta, stop]) });
    const sessionStore = createClaudeAgentSdkSessionStore();
    sessionStore.set(session);
    await consumeClaudeSession({
      session,
      sessionStore,
      now: () => timestamp,
      emit: (_session, event) => events.push(event),
      onBackgroundFailure: ignoreClaudeBackgroundFailure,
    });
    expect(events.filter((event) => event.type === "session_error")).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('tool input for "write-1" (Write, block 0)'),
      }),
    ]);
    expect(events.filter((event) => event.type === "assistant_part")).toHaveLength(1);
    expect(events.at(-1)?.type).toBe("session_finished");
    expect(sessionStore.get(session.externalSessionId)).toBeUndefined();
    expect(completeClaudeStreamToolInput(session, 0)).toBeNull();
  });

  test.each([
    { json: "null", input: {} },
    { json: '{"content":', input: { __unparsedToolInput: { raw: '{"content":', len: 11 } } },
  ])("rejects raw $json after the SDK sends its normalized envelope", async ({ json, input }) => {
    const events: AgentEvent[] = [];
    const rawDelta = claudeSdkMessageFixture({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: json },
      },
    });
    const envelope = claudeSdkMessageFixture({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "write-1", name: "Write", input }],
      },
    });
    const session = createClaudeSession({
      query: claudeQueryWithMessages([start, rawDelta, envelope, stop]),
    });
    const sessionStore = createClaudeAgentSdkSessionStore();
    sessionStore.set(session);
    await consumeClaudeSession({
      session,
      sessionStore,
      now: () => timestamp,
      emit: (_session, event) => events.push(event),
      onBackgroundFailure: ignoreClaudeBackgroundFailure,
    });
    expect(events.filter((event) => event.type === "session_error")).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('tool input for "write-1" (Write, block 0)'),
      }),
    ]);
    expect(events.filter((event) => event.type === "assistant_part")).toHaveLength(1);
    expect(session.toolInputsByCallId.get("write-1")).toEqual({});
    expect(sessionStore.get(session.externalSessionId)).toBeUndefined();
  });

  test("cancellation clears an unfinished tool without parsing or emitting an input update", async () => {
    const events: AgentEvent[] = [];
    const session = createClaudeSession();
    const sessionStore = createClaudeAgentSdkSessionStore();
    sessionStore.set(session);
    for (const message of [start, delta]) {
      handleClaudeSdkMessage({
        session,
        message,
        timestamp,
        modelSelection,
        emit: (event) => events.push(event),
      });
    }
    await Effect.runPromise(sessionStore.stopSession(claudeSessionRef(session)));
    expect(completeClaudeStreamToolInput(session, 0)).toBeNull();
    expect(consumeClaudeStreamEmittedToolInput(session, "write-1", {})).toBe(false);
    expect(events.filter((event) => event.type === "assistant_part")).toHaveLength(1);
  });

  test("a parent result preserves input from a running child", () => {
    const session = createEventTestSession();
    session.activeBackgroundSubagentTaskIds = new Set(["child"]);
    session.subagentTaskIdsByToolUseId.set("agent-tool", "child");
    const emit = () => {};
    for (const message of [start, delta]) {
      handleClaudeSdkMessage({
        session,
        message: { ...message, parent_tool_use_id: "agent-tool" },
        timestamp,
        modelSelection,
        emit,
      });
    }
    handleClaudeSdkMessage({
      session,
      message: claudeSdkMessageFixture({ type: "result", subtype: "success", result: "done" }),
      timestamp,
      modelSelection,
      emit,
    });
    handleClaudeSdkMessage({
      session,
      message: claudeSdkMessageFixture({
        type: "stream_event",
        parent_tool_use_id: "agent-tool",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '"child"}' },
        },
      }),
      timestamp,
      modelSelection,
      emit,
    });
    handleClaudeSdkMessage({
      session,
      message: { ...stop, parent_tool_use_id: "agent-tool" },
      timestamp,
      modelSelection,
      emit,
    });
    const child = session.subagentEventSessionsByToolUseId?.get("agent-tool");
    expect(child?.toolInputsByCallId.get("write-1")).toEqual({ content: "child" });
    expect(session.toolInputsByCallId.has("write-1")).toBe(false);
  });

  test.each(["message_start", "result"] as const)("discards incomplete input on %s", (boundary) => {
    const session = createEventTestSession();
    const events: AgentEvent[] = [];
    const message =
      boundary === "message_start"
        ? claudeSdkMessageFixture({ type: "stream_event", event: { type: "message_start" } })
        : claudeSdkMessageFixture({ type: "result", subtype: "success", result: "done" });
    for (const eventMessage of [start, delta, message, stop]) {
      handleClaudeSdkMessage({
        session,
        message: eventMessage,
        timestamp,
        modelSelection,
        emit: (event) => events.push(event),
      });
    }
    expect(events.filter((event) => event.type === "assistant_part")).toHaveLength(1);
    expect(consumeClaudeStreamEmittedToolInput(session, "write-1", {})).toBe(false);
  });
});
