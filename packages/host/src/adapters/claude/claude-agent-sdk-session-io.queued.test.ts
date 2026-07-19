import { describe, expect, mock, test } from "bun:test";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "@openducktor/core";
import { AsyncInputQueue } from "./claude-agent-sdk-queue";
import { flushQueuedClaudeUserMessage, sendClaudeUserMessage } from "./claude-agent-sdk-session-io";
import { createClaudeSession } from "./claude-agent-sdk-session-io.test-support";
import type { ClaudeSession } from "./claude-agent-sdk-types";

describe("Claude session I/O queued messages", () => {
  test("accepts queued user messages while the Claude SDK session is running", async () => {
    const pushed: SDKUserMessage[] = [];
    const events: AgentEvent[] = [];
    const queue = new AsyncInputQueue<SDKUserMessage>();
    queue.push = (message) => {
      pushed.push(message);
    };
    const session = createClaudeSession({
      activeSdkUserTurnCount: 1,
      activity: "running",
      sdkState: "running",
      query: {
        applyFlagSettings: mock(async (_settings: unknown) => {}),
        setModel: mock(async (_model?: string) => {}),
      } as unknown as ClaudeSession["query"],
      queue,
    });

    const accepted = await sendClaudeUserMessage({
      session,
      now: () => "2026-06-25T20:00:00.000Z",
      randomId: () => "message-1",
      emit: (_session, event) => events.push(event),
      messageInput: {
        externalSessionId: "session-1",
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo",
        runtimePolicy: { kind: "claude" },
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        parts: [{ kind: "text", text: "continue while running" }],
      },
    });

    expect(accepted.message).toBe("continue while running");
    expect(accepted.state).toBe("queued");
    expect(session.activity).toBe("running");
    expect(session.pendingUserTurnCount).toBe(1);
    expect(session.queuedSdkMessages).toEqual([
      expect.objectContaining({
        type: "user",
        uuid: "message-1",
        session_id: "session-1",
      }),
    ]);
    expect(pushed).toEqual([]);
    expect(events).toEqual([
      expect.objectContaining({
        type: "session_status",
        status: { type: "busy", message: null },
      }),
    ]);
  });

  test("marks the local user turn pending before sending it to the SDK queue", async () => {
    const events: AgentEvent[] = [];
    const queue = new AsyncInputQueue<SDKUserMessage>();
    const messageId = "00000000-0000-4000-8000-000000000001";
    const session = createClaudeSession({
      activity: "idle",
      model: {
        providerId: "claude",
        modelId: "claude-sonnet-4-6",
        runtimeKind: "claude",
        variant: "high",
      },
      query: {
        applyFlagSettings: mock(async (_settings: unknown) => {}),
        setModel: mock(async (_model?: string) => {}),
      } as unknown as ClaudeSession["query"],
      queue,
    });
    queue.push = (message) => {
      expect(message.uuid).toBe(messageId);
      expect(session.acceptedUserMessages).toEqual([
        {
          messageId,
          parts: [{ kind: "text", text: "start work" }],
          text: "start work",
          timestamp: "2026-06-25T20:00:00.000Z",
        },
      ]);
      expect(session.pendingUserTurnCount).toBe(1);
      expect(session.activity).toBe("running");
      expect(session.sdkState).toBe("running");
    };

    await expect(
      sendClaudeUserMessage({
        session,
        now: () => "2026-06-25T20:00:00.000Z",
        randomId: () => messageId,
        emit: (_session, event) => events.push(event),
        messageInput: {
          externalSessionId: "session-1",
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo",
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          parts: [{ kind: "text", text: "start work" }],
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        messageId,
        message: "start work",
      }),
    );
    expect(events).toEqual([
      expect.objectContaining({
        type: "session_status",
        status: { type: "busy", message: null },
      }),
    ]);
  });

  test("flushes the next queued user message after the active SDK turn completes", async () => {
    const events: AgentEvent[] = [];
    const pushed: SDKUserMessage[] = [];
    const queue = new AsyncInputQueue<SDKUserMessage>();
    queue.push = (message) => {
      pushed.push(message);
    };
    const session = createClaudeSession({
      acceptedUserMessages: [
        {
          messageId: "00000000-0000-4000-8000-000000000002",
          parts: [{ kind: "text", text: "queued" }],
          text: "queued",
          timestamp: "2026-06-25T20:00:01.000Z",
        },
      ],
      activeSdkUserTurnCount: 0,
      activity: "running",
      pendingUserTurnCount: 1,
      queue,
      queuedSdkMessages: [
        {
          type: "user",
          uuid: "00000000-0000-4000-8000-000000000002",
          session_id: "session-1",
          timestamp: "2026-06-25T20:00:01.000Z",
          parent_tool_use_id: null,
          message: {
            role: "user",
            content: [{ type: "text", text: "queued" }],
          },
        },
      ],
      sdkState: "idle",
    });

    await flushQueuedClaudeUserMessage({
      emit: (_session, event) => events.push(event),
      now: () => "2026-06-25T20:00:02.000Z",
      session,
    });

    expect(pushed).toEqual([
      expect.objectContaining({
        type: "user",
        uuid: "00000000-0000-4000-8000-000000000002",
        session_id: "session-1",
      }),
    ]);
    expect(session.activeSdkUserTurnCount).toBe(1);
    expect(session.queuedSdkMessages).toEqual([]);
    expect(session.activity).toBe("running");
    expect(events).toEqual([
      expect.objectContaining({
        type: "user_message",
        externalSessionId: "session-1",
        messageId: "00000000-0000-4000-8000-000000000002",
        state: "read",
      }),
      expect.objectContaining({
        type: "session_status",
        externalSessionId: "session-1",
        status: { type: "busy", message: null },
      }),
    ]);
  });

  test("defers queued message model updates until that queued message is flushed", async () => {
    const events: AgentEvent[] = [];
    const pushed: SDKUserMessage[] = [];
    const setModel = mock(async (_model?: string) => {});
    const applyFlagSettings = mock(async (_settings: unknown) => {});
    const queue = new AsyncInputQueue<SDKUserMessage>();
    queue.push = (message) => {
      pushed.push(message);
    };
    const session = createClaudeSession({
      activeSdkUserTurnCount: 1,
      activity: "running",
      model: {
        providerId: "claude",
        modelId: "claude-sonnet-4-6",
        runtimeKind: "claude",
        variant: "high",
      },
      query: {
        applyFlagSettings,
        setModel,
      } as unknown as ClaudeSession["query"],
      queue,
      sdkState: "running",
    });

    const accepted = await sendClaudeUserMessage({
      session,
      now: () => "2026-06-25T20:00:00.000Z",
      randomId: () => "00000000-0000-4000-8000-000000000003",
      emit: (_session, event) => events.push(event),
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
        parts: [{ kind: "text", text: "use opus next" }],
      },
    });

    expect(accepted.state).toBe("queued");
    expect(setModel).not.toHaveBeenCalled();
    expect(applyFlagSettings).not.toHaveBeenCalled();
    expect(session.model?.modelId).toBe("claude-sonnet-4-6");
    expect(session.model?.variant).toBe("high");
    expect(pushed).toEqual([]);

    session.activeSdkUserTurnCount = 0;
    session.sdkState = "idle";
    await flushQueuedClaudeUserMessage({
      emit: (_session, event) => events.push(event),
      now: () => "2026-06-25T20:00:01.000Z",
      session,
    });

    expect(setModel).toHaveBeenCalledWith("claude-opus-4-6");
    expect(applyFlagSettings).toHaveBeenCalledWith({ effortLevel: "xhigh" });
    expect(session.model?.modelId).toBe("claude-opus-4-6");
    expect(session.model?.variant).toBe("xhigh");
    expect(pushed).toEqual([
      expect.objectContaining({
        uuid: "00000000-0000-4000-8000-000000000003",
      }),
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "user_message",
        messageId: "00000000-0000-4000-8000-000000000003",
        state: "read",
      }),
    );
  });

  test("restores model and session state when queued message flushing fails after model update", async () => {
    const queue = new AsyncInputQueue<SDKUserMessage>();
    queue.push = () => {
      throw new Error("queue unavailable");
    };
    const queuedMessage: SDKUserMessage = {
      type: "user",
      uuid: "00000000-0000-4000-8000-000000000003",
      session_id: "session-1",
      timestamp: "2026-06-25T20:00:00.000Z",
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [{ type: "text", text: "use opus next" }],
      },
    };
    const session = createClaudeSession({
      acceptedUserMessages: [
        {
          messageId: "00000000-0000-4000-8000-000000000003",
          model: {
            providerId: "claude",
            modelId: "claude-opus-4-6",
            runtimeKind: "claude",
            variant: "xhigh",
          },
          parts: [{ kind: "text", text: "use opus next" }],
          text: "use opus next",
          timestamp: "2026-06-25T20:00:00.000Z",
        },
      ],
      activity: "running",
      model: {
        providerId: "claude",
        modelId: "claude-sonnet-4-6",
        runtimeKind: "claude",
        variant: "high",
      },
      query: {
        applyFlagSettings: mock(async (_settings: unknown) => {}),
        setModel: mock(async (_model?: string) => {}),
      } as unknown as ClaudeSession["query"],
      queue,
      queuedSdkMessages: [queuedMessage],
      sdkState: "idle",
    });

    await expect(
      flushQueuedClaudeUserMessage({
        emit: () => {},
        now: () => "2026-06-25T20:00:01.000Z",
        session,
      }),
    ).rejects.toThrow("queue unavailable");

    expect(session.queuedSdkMessages).toEqual([queuedMessage]);
    expect(session.activeSdkUserTurnCount).toBe(0);
    expect(session.activity).toBe("running");
    expect(session.sdkState).toBe("idle");
    expect(session.model).toEqual({
      providerId: "claude",
      modelId: "claude-sonnet-4-6",
      runtimeKind: "claude",
      variant: "high",
    });
  });

  test("does not let new sends overtake already queued SDK messages", async () => {
    const pushed: SDKUserMessage[] = [];
    const queue = new AsyncInputQueue<SDKUserMessage>();
    queue.push = (message) => {
      pushed.push(message);
    };
    const session = createClaudeSession({
      activity: "running",
      pendingUserTurnCount: 1,
      queue,
      queuedSdkMessages: [
        {
          type: "user",
          uuid: "00000000-0000-4000-8000-000000000002",
          session_id: "session-1",
          timestamp: "2026-06-25T20:00:01.000Z",
          parent_tool_use_id: null,
          message: {
            role: "user",
            content: [{ type: "text", text: "first queued" }],
          },
        },
      ],
      sdkState: "idle",
    });

    await sendClaudeUserMessage({
      session,
      now: () => "2026-06-25T20:00:02.000Z",
      randomId: () => "00000000-0000-4000-8000-000000000003",
      emit: () => {},
      messageInput: {
        externalSessionId: "session-1",
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo",
        runtimePolicy: { kind: "claude" },
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        parts: [{ kind: "text", text: "second queued" }],
      },
    });

    expect(pushed).toEqual([]);
    expect(session.queuedSdkMessages.map((message) => message.uuid)).toEqual([
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003",
    ]);
  });

  test("does not mark user messages accepted when the Claude input queue is closed", async () => {
    const events: AgentEvent[] = [];
    const queue = new AsyncInputQueue<SDKUserMessage>();
    queue.close();
    const session = createClaudeSession({
      activity: "idle",
      model: {
        providerId: "claude",
        modelId: "claude-sonnet-4-6",
        runtimeKind: "claude",
        variant: "high",
      },
      query: {
        applyFlagSettings: mock(async (_settings: unknown) => {}),
        setModel: mock(async (_model?: string) => {}),
      } as unknown as ClaudeSession["query"],
      queue,
    });

    await expect(
      sendClaudeUserMessage({
        session,
        now: () => "2026-06-25T20:00:00.000Z",
        randomId: () => "message-1",
        emit: (_session, event) => events.push(event),
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
          parts: [{ kind: "text", text: "should not be accepted" }],
        },
      }),
    ).rejects.toThrow("Cannot send input to a closed Claude Agent SDK session.");

    expect(session.acceptedUserMessages).toEqual([]);
    expect(session.pendingUserTurnCount).toBe(0);
    expect(session.activity).toBe("idle");
    expect(session.model).toEqual({
      providerId: "claude",
      modelId: "claude-sonnet-4-6",
      runtimeKind: "claude",
      variant: "high",
    });
    expect(events).toEqual([]);
  });
});
