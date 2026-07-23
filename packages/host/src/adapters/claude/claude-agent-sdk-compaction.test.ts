import { describe, expect, test } from "bun:test";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { MANUAL_SESSION_COMPACTION_SLASH_COMMAND } from "@openducktor/contracts";
import type { AgentEvent, SendAgentUserMessageInput } from "@openducktor/core";
import type { ClaudeEventSession } from "./claude-agent-sdk-event-session";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession } from "./claude-agent-sdk-events.test-support";
import { toClaudeHistoryMessages } from "./claude-agent-sdk-history";
import { AsyncInputQueue } from "./claude-agent-sdk-queue";
import { flushQueuedClaudeUserMessage, sendClaudeUserMessage } from "./claude-agent-sdk-session-io";
import { createClaudeSession } from "./claude-agent-sdk-session-io.test-support";
import {
  claudeHistoryMessageFixtures,
  claudeSdkMessageFixture,
} from "./claude-agent-sdk-test-messages";

const compactMessageInput = (): SendAgentUserMessageInput => ({
  externalSessionId: "session-1",
  repoPath: "/repo",
  runtimeKind: "claude",
  workingDirectory: "/repo",
  runtimePolicy: { kind: "claude" },
  sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
  parts: [
    {
      kind: "slash_command",
      command: MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
    },
  ],
});

const modelSelection = (model: string) => ({
  providerId: "claude",
  modelId: model,
  runtimeKind: "claude" as const,
});

describe("Claude manual compaction", () => {
  test("sends the native command and starts the shared compaction lifecycle", async () => {
    const pushed: SDKUserMessage[] = [];
    const queue = new AsyncInputQueue<SDKUserMessage>();
    queue.push = (message) => pushed.push(message);
    const session = createClaudeSession({ queue });
    const events: AgentEvent[] = [];

    const accepted = await sendClaudeUserMessage({
      session,
      messageInput: compactMessageInput(),
      now: () => "2026-07-23T10:00:00.000Z",
      randomId: () => "compact-request-1",
      emit: (_session, event) => events.push(event),
    });

    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.message).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "/compact" }],
    });
    expect(accepted.message).toBe("/compact");
    expect(session.activeManualCompaction).toEqual({
      messageId: "compact-request-1",
      boundaryReceived: false,
    });
    expect(events).toContainEqual({
      type: "session_compaction_started",
      externalSessionId: "session-1",
      timestamp: "2026-07-23T10:00:00.000Z",
      messageId: "compact-request-1",
      message: "Session compaction started.",
    });
  });

  test("settles a manual compaction boundary with the request message id", () => {
    const events: AgentEvent[] = [];
    const session: ClaudeEventSession = createEventTestSession();
    session.activeManualCompaction = {
      messageId: "compact-request-1",
      boundaryReceived: false,
    };

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-07-23T10:00:02.000Z",
      modelSelection,
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "system",
        subtype: "compact_boundary",
        uuid: "compact-boundary-1",
        session_id: "session-1",
        compact_metadata: {
          trigger: "manual",
          pre_tokens: 12_000,
          post_tokens: 2_000,
        },
      }),
    });

    expect(session.activeManualCompaction.boundaryReceived).toBe(true);
    expect(events).toEqual([
      {
        type: "session_compacted",
        externalSessionId: "session-1",
        timestamp: "2026-07-23T10:00:02.000Z",
        messageId: "compact-request-1",
        message: "Session compacted.",
      },
    ]);
  });

  test("starts queued compaction only when Claude receives the queued command", async () => {
    const events: AgentEvent[] = [];
    const pushed: SDKUserMessage[] = [];
    const queue = new AsyncInputQueue<SDKUserMessage>();
    queue.push = (message) => pushed.push(message);
    const session = createClaudeSession({
      activeSdkUserTurnCount: 1,
      activity: "running",
      sdkState: "running",
      queue,
    });

    await sendClaudeUserMessage({
      session,
      messageInput: compactMessageInput(),
      now: () => "2026-07-23T10:00:00.000Z",
      randomId: () => "compact-request-1",
      emit: (_session, event) => events.push(event),
    });

    expect(pushed).toEqual([]);
    expect(events.some((event) => event.type === "session_compaction_started")).toBe(false);

    session.activeSdkUserTurnCount = 0;
    session.sdkState = "idle";
    await flushQueuedClaudeUserMessage({
      session,
      now: () => "2026-07-23T10:00:03.000Z",
      emit: (_session, event) => events.push(event),
    });

    expect(pushed).toHaveLength(1);
    expect(events).toContainEqual({
      type: "session_compaction_started",
      externalSessionId: "session-1",
      timestamp: "2026-07-23T10:00:03.000Z",
      messageId: "compact-request-1",
      message: "Session compaction started.",
    });
    expect(events.some((event) => event.type === "user_message")).toBe(false);
  });

  test("settles a successful no-op without exposing the SDK result as assistant output", () => {
    const events: AgentEvent[] = [];
    const session: ClaudeEventSession = createEventTestSession();
    session.activeSdkUserTurnCount = 1;
    session.pendingUserTurnCount = 1;
    session.activeManualCompaction = {
      messageId: "compact-request-1",
      boundaryReceived: false,
    };

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-07-23T10:00:02.000Z",
      modelSelection,
      emit: (event) => events.push(event),
      message: claudeSdkMessageFixture({
        type: "result",
        subtype: "success",
        uuid: "compact-result-1",
        session_id: "session-1",
        is_error: false,
        result: "Not enough messages to compact.",
        stop_reason: "end_turn",
        terminal_reason: "completed",
      }),
    });

    expect(session.activeManualCompaction).toBeUndefined();
    expect(events).toContainEqual({
      type: "session_compacted",
      externalSessionId: "session-1",
      timestamp: "2026-07-23T10:00:02.000Z",
      messageId: "compact-request-1",
      message: "Not enough messages to compact.",
    });
    expect(events.some((event) => event.type === "assistant_message")).toBe(false);
    expect(events.some((event) => event.type === "session_idle")).toBe(true);
  });

  test("hydrates a manual compact boundary as the same shared notice", () => {
    const history = toClaudeHistoryMessages(
      claudeHistoryMessageFixtures([
        {
          type: "system",
          subtype: "local_command",
          uuid: "compact-request-1",
          session_id: "session-1",
          timestamp: "2026-07-23T10:00:00.000Z",
          content:
            "<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>",
        },
        {
          type: "system",
          subtype: "compact_boundary",
          uuid: "compact-boundary-1",
          session_id: "session-1",
          timestamp: "2026-07-23T10:00:02.000Z",
          compact_metadata: { trigger: "manual", pre_tokens: 12_000, post_tokens: 2_000 },
        },
        {
          type: "result",
          subtype: "success",
          uuid: "compact-result-1",
          session_id: "session-1",
          timestamp: "2026-07-23T10:00:02.100Z",
          is_error: false,
          result: "Compaction completed.",
        },
      ]),
      () => "2026-07-23T11:00:00.000Z",
    );

    expect(history).toEqual([
      {
        messageId: "compact-request-1",
        role: "system",
        timestamp: "2026-07-23T10:00:02.000Z",
        text: "Session compacted.",
        notice: {
          tone: "info",
          reason: "session_compacted",
          title: "Compacted",
        },
        parts: [],
      },
    ]);
  });

  test("hides Claude's compact summary and hook output after hydration", () => {
    const history = toClaudeHistoryMessages(
      claudeHistoryMessageFixtures([
        {
          type: "queue-operation",
          operation: "enqueue",
          timestamp: "2026-07-23T10:00:00.000Z",
          sessionId: "session-1",
          content: "/compact",
        },
        {
          type: "system",
          subtype: "compact_boundary",
          uuid: "compact-boundary-1",
          session_id: "session-1",
          timestamp: "2026-07-23T10:00:02.000Z",
          compact_metadata: { trigger: "manual", pre_tokens: 12_000, post_tokens: 2_000 },
        },
        {
          type: "user",
          uuid: "compact-summary-1",
          session_id: "session-1",
          timestamp: "2026-07-23T10:00:02.000Z",
          isCompactSummary: true,
          promptId: "compact-prompt-1",
          message: {
            role: "user",
            content:
              "This session is being continued from a previous conversation that ran out of context.",
          },
        },
        {
          type: "user",
          uuid: "compact-command-caveat-1",
          session_id: "session-1",
          timestamp: "2026-07-23T10:00:00.100Z",
          promptId: "compact-prompt-1",
          message: {
            role: "user",
            content:
              "<local-command-caveat>Internal local command guidance.</local-command-caveat>",
          },
        },
        {
          type: "user",
          uuid: "compact-command-1",
          session_id: "session-1",
          timestamp: "2026-07-23T10:00:00.100Z",
          promptId: "compact-prompt-1",
          message: {
            role: "user",
            content:
              "<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>",
          },
        },
        {
          type: "user",
          uuid: "compact-hook-output-1",
          session_id: "session-1",
          timestamp: "2026-07-23T10:00:02.100Z",
          promptId: "compact-prompt-1",
          message: {
            role: "user",
            content:
              "<local-command-stdout>Compacted PreCompact hook completed successfully</local-command-stdout>",
          },
        },
        {
          type: "result",
          subtype: "success",
          uuid: "compact-result-1",
          session_id: "session-1",
          timestamp: "2026-07-23T10:00:02.200Z",
          is_error: false,
          result: "Compaction completed.",
        },
      ]),
      () => "2026-07-23T11:00:00.000Z",
    );

    expect(history).toEqual([
      {
        messageId: "compact-boundary-1",
        role: "system",
        timestamp: "2026-07-23T10:00:02.000Z",
        text: "Session compacted.",
        notice: {
          tone: "info",
          reason: "session_compacted",
          title: "Compacted",
        },
        parts: [],
      },
    ]);
  });

  test("hydrates a manual compact no-op without a user or assistant duplicate", () => {
    const history = toClaudeHistoryMessages(
      claudeHistoryMessageFixtures([
        {
          type: "system",
          subtype: "local_command",
          uuid: "compact-request-1",
          session_id: "session-1",
          timestamp: "2026-07-23T10:00:00.000Z",
          content:
            "<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>",
        },
        {
          type: "result",
          subtype: "success",
          uuid: "compact-result-1",
          session_id: "session-1",
          timestamp: "2026-07-23T10:00:02.100Z",
          is_error: false,
          result: "Not enough messages to compact.",
        },
      ]),
      () => "2026-07-23T11:00:00.000Z",
    );

    expect(history).toEqual([
      {
        messageId: "compact-request-1",
        role: "system",
        timestamp: "2026-07-23T10:00:02.100Z",
        text: "Not enough messages to compact.",
        notice: {
          tone: "info",
          reason: "session_compacted",
          title: "Compacted",
        },
        parts: [],
      },
    ]);
  });

  test("keeps failed manual compaction visible after hydration", () => {
    const history = toClaudeHistoryMessages(
      claudeHistoryMessageFixtures([
        {
          type: "system",
          subtype: "local_command",
          uuid: "compact-request-1",
          session_id: "session-1",
          timestamp: "2026-07-23T10:00:00.000Z",
          content:
            "<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>",
        },
        {
          type: "result",
          subtype: "error_during_execution",
          uuid: "compact-result-1",
          session_id: "session-1",
          timestamp: "2026-07-23T10:00:02.100Z",
          is_error: true,
          errors: ["Compaction failed."],
          result: "",
          terminal_reason: "error",
        },
      ]),
      () => "2026-07-23T11:00:00.000Z",
    );

    expect(history).toEqual([
      {
        messageId: "compact-result-1",
        role: "system",
        timestamp: "2026-07-23T10:00:02.100Z",
        text: "Compaction failed.",
        parts: [],
      },
    ]);
  });

  test("projects automatic compact boundaries in both live and hydrated paths", () => {
    const events: AgentEvent[] = [];
    const session: ClaudeEventSession = createEventTestSession();
    const boundary = claudeSdkMessageFixture({
      type: "system",
      subtype: "compact_boundary",
      uuid: "compact-boundary-1",
      session_id: "session-1",
      timestamp: "2026-07-23T10:00:02.000Z",
      compact_metadata: { trigger: "auto", pre_tokens: 12_000, post_tokens: 2_000 },
    });

    handleClaudeSdkMessage({
      session,
      timestamp: "2026-07-23T10:00:02.000Z",
      modelSelection,
      emit: (event) => events.push(event),
      message: boundary,
    });
    const history = toClaudeHistoryMessages(
      claudeHistoryMessageFixtures([boundary]),
      () => "2026-07-23T11:00:00.000Z",
    );

    expect(events).toEqual([
      {
        type: "session_compacted",
        externalSessionId: "session-1",
        timestamp: "2026-07-23T10:00:02.000Z",
        messageId: "compact-boundary-1",
        message: "Session compacted.",
      },
    ]);
    expect(history).toEqual([
      {
        messageId: "compact-boundary-1",
        role: "system",
        timestamp: "2026-07-23T10:00:02.000Z",
        text: "Session compacted.",
        notice: {
          tone: "info",
          reason: "session_compacted",
          title: "Compacted",
        },
        parts: [],
      },
    ]);
  });
});
