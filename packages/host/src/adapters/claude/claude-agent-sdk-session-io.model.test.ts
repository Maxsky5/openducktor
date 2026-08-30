import { describe, expect, mock, test } from "bun:test";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { AsyncInputQueue } from "./claude-agent-sdk-queue";
import { sendClaudeUserMessage } from "./claude-agent-sdk-session-io";
import {
  createClaudeQueryFixture,
  createClaudeSession,
} from "./claude-agent-sdk-session-io.test-support";

const MESSAGE_ID = "00000000-0000-4000-8000-000000000001";

describe("Claude session I/O model changes", () => {
  test("does not change the query creation system prompt on later sends", async () => {
    const queue = new AsyncInputQueue<SDKUserMessage>();
    const session = createClaudeSession({ queue });
    const originalInput = session.input;

    await sendClaudeUserMessage({
      session,
      now: () => "2026-06-25T20:00:00.000Z",
      randomId: () => MESSAGE_ID,
      emit: () => {},
      messageInput: {
        externalSessionId: "session-1",
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo",
        runtimePolicy: { kind: "claude" },
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        systemPrompt: "Replacement prompt",
        parts: [{ kind: "text", text: "hello" }],
      },
    });

    expect(session.input).toBe(originalInput);
    expect(session.input.systemPrompt).toBe("Build");
  });

  test("applies per-message model changes through the Claude SDK query", async () => {
    const setModel = mock(async (_model?: string) => {});
    const pushed: SDKUserMessage[] = [];
    const queue = new AsyncInputQueue<SDKUserMessage>();
    queue.push = (message) => {
      pushed.push(message);
    };
    const session = createClaudeSession({
      activity: "idle",
      query: createClaudeQueryFixture({ setModel }),
      queue,
    });

    await sendClaudeUserMessage({
      session,
      now: () => "2026-06-25T20:00:00.000Z",
      randomId: () => MESSAGE_ID,
      emit: () => {},
      messageInput: {
        externalSessionId: "session-1",
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo",
        runtimePolicy: { kind: "claude" },
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        model: {
          providerId: "claude",
          modelId: "claude-opus-4-6",
          runtimeKind: "claude",
        },
        parts: [{ kind: "text", text: "hello" }],
      },
    });

    expect(setModel).toHaveBeenCalledWith("claude-opus-4-6");
    expect(session.model?.modelId).toBe("claude-opus-4-6");
    expect(pushed).toHaveLength(1);
    expect(session.activeSdkUserTurnCount).toBe(1);
    expect(session.acceptedUserMessages).toEqual([
      {
        messageId: MESSAGE_ID,
        model: {
          providerId: "claude",
          modelId: "claude-opus-4-6",
          runtimeKind: "claude",
        },
        parts: [{ kind: "text", text: "hello" }],
        text: "hello",
        timestamp: "2026-06-25T20:00:00.000Z",
      },
    ]);
  });

  test("applies supported per-message effort changes through Claude flag settings", async () => {
    const setModel = mock(async (_model?: string) => {});
    const applyFlagSettings = mock(async () => {});
    const pushed: SDKUserMessage[] = [];
    const queue = new AsyncInputQueue<SDKUserMessage>();
    queue.push = (message) => {
      pushed.push(message);
    };
    const session = createClaudeSession({
      activity: "idle",
      model: {
        providerId: "claude",
        modelId: "claude-opus-4-6",
        runtimeKind: "claude",
        variant: "high",
      },
      query: createClaudeQueryFixture({
        applyFlagSettings,
        setModel,
      }),
      queue,
    });

    await sendClaudeUserMessage({
      session,
      now: () => "2026-06-25T20:00:00.000Z",
      randomId: () => MESSAGE_ID,
      emit: () => {},
      messageInput: {
        externalSessionId: "session-1",
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo",
        runtimePolicy: { kind: "claude" },
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        model: {
          providerId: "claude",
          modelId: "claude-opus-4-6",
          runtimeKind: "claude",
          variant: "xhigh",
        },
        parts: [{ kind: "text", text: "hello" }],
      },
    });

    expect(setModel).not.toHaveBeenCalled();
    expect(applyFlagSettings).toHaveBeenCalledWith({ effortLevel: "xhigh" });
    expect(session.model?.variant).toBe("xhigh");
    expect(pushed).toHaveLength(1);
  });

  test("rolls the Claude SDK model back when message delivery fails", async () => {
    const setModel = mock(async (_model?: string) => {});
    const queue = new AsyncInputQueue<SDKUserMessage>();
    queue.push = () => {
      throw new Error("queue unavailable");
    };
    const session = createClaudeSession({
      activity: "idle",
      model: {
        providerId: "claude",
        modelId: "claude-sonnet-4-6",
        runtimeKind: "claude",
      },
      query: createClaudeQueryFixture({ setModel }),
      queue,
    });

    await expect(
      sendClaudeUserMessage({
        session,
        now: () => "2026-06-25T20:00:00.000Z",
        randomId: () => MESSAGE_ID,
        emit: () => {},
        messageInput: {
          externalSessionId: "session-1",
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo",
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          model: {
            providerId: "claude",
            modelId: "claude-opus-4-6",
            runtimeKind: "claude",
          },
          parts: [{ kind: "text", text: "hello" }],
        },
      }),
    ).rejects.toThrow("queue unavailable");

    expect(setModel.mock.calls.map(([model]) => model)).toEqual([
      "claude-opus-4-6",
      "claude-sonnet-4-6",
    ]);
    expect(session.model?.modelId).toBe("claude-sonnet-4-6");
  });
});
