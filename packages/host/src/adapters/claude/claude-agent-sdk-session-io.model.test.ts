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

  test.each([
    { previous: undefined, next: "fast", settings: { fastMode: true } },
    { previous: "fast", next: undefined, settings: { fastMode: false } },
  ])("applies a speed change from $previous to $next as fast mode", async (change) => {
    const applyFlagSettings = mock(async () => {});
    const model = {
      providerId: "claude",
      modelId: "claude-opus-4-6",
      runtimeKind: "claude" as const,
    };
    const session = createClaudeSession({
      activity: "idle",
      model: change.previous ? { ...model, speed: change.previous } : model,
      query: createClaudeQueryFixture({ applyFlagSettings }),
    });
    session.queue.push = () => {};

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
        model: change.next ? { ...model, speed: change.next } : model,
        parts: [{ kind: "text", text: "hello" }],
      },
    });

    expect(applyFlagSettings).toHaveBeenCalledWith(change.settings);
    expect(session.model?.speed).toBe(change.next);
  });

  test("rejects a speed that Claude does not support before delivery", async () => {
    const applyFlagSettings = mock(async () => {});
    const model = {
      providerId: "claude",
      modelId: "claude-opus-4-6",
      runtimeKind: "claude" as const,
    };
    const session = createClaudeSession({
      activity: "idle",
      model,
      query: createClaudeQueryFixture({ applyFlagSettings }),
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
          model: { ...model, speed: "priority" },
          parts: [{ kind: "text", text: "hello" }],
        },
      }),
    ).rejects.toThrow("does not support speed 'priority'");
    expect(applyFlagSettings).not.toHaveBeenCalled();
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

  test("reports the native send only after the message enters the SDK input queue", async () => {
    const messageInput = {
      externalSessionId: "session-1",
      repoPath: "/repo",
      runtimeKind: "claude" as const,
      workingDirectory: "/repo",
      runtimePolicy: { kind: "claude" as const },
      sessionScope: { kind: "workflow" as const, taskId: "task-1", role: "build" as const },
      parts: [{ kind: "text" as const, text: "hello" }],
    };
    const send = (queue: AsyncInputQueue<SDKUserMessage>, onSent: () => void) =>
      sendClaudeUserMessage({
        session: createClaudeSession({ activity: "idle", queue }),
        now: () => "2026-06-25T20:00:00.000Z",
        randomId: () => MESSAGE_ID,
        emit: () => {},
        messageInput,
        onSent,
      });
    const sent: string[] = [];
    await send(new AsyncInputQueue<SDKUserMessage>(), () => sent.push("pushed"));
    expect(sent).toEqual(["pushed"]);

    const closed = new AsyncInputQueue<SDKUserMessage>();
    closed.push = () => {
      throw new Error("queue unavailable");
    };
    // A failed push leaves the message outside the SDK, so the caller can send it again.
    await expect(send(closed, () => sent.push("closed"))).rejects.toThrow("queue unavailable");
    expect(sent).toEqual(["pushed"]);
  });
});
