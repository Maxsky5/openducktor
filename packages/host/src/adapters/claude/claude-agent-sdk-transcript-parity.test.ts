import { describe, expect, test } from "bun:test";
import type { AgentEvent, AgentUserMessagePart } from "@openducktor/core";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession } from "./claude-agent-sdk-events.test-support";
import { toClaudeHistoryMessages } from "./claude-agent-sdk-history";
import { toClaudeMessageFromParts } from "./claude-agent-sdk-messages";
import { sendClaudeUserMessage } from "./claude-agent-sdk-session-io";
import { createClaudeSession } from "./claude-agent-sdk-session-io.test-support";
import {
  claudeHistoryMessageFixtures,
  claudeSdkMessageFixture,
  claudeSdkMessageUuidFixture,
  claudeSessionMessageFixture,
} from "./claude-agent-sdk-test-messages";
import { handleClaudeUserToolResultMessage } from "./claude-agent-sdk-tool-results";

const timestamp = "2026-06-25T20:00:00.000Z";
const resultTimestamp = "2026-06-25T20:00:02.000Z";
const STRUCTURED_USER_MESSAGE_ID = "00000000-0000-4000-8000-000000000006";

const assistantParts = (events: AgentEvent[]) =>
  events.flatMap((event) => (event.type === "assistant_part" ? [event.part] : []));

const retainedLiveAssistantMessageIds = (events: AgentEvent[]): string[] => {
  const messageIds: string[] = [];
  for (const event of events) {
    if (event.type === "transcript_retracted") {
      const retractedIds = new Set(event.messageIds);
      for (let index = messageIds.length - 1; index >= 0; index -= 1) {
        if (retractedIds.has(messageIds[index] ?? "")) {
          messageIds.splice(index, 1);
        }
      }
      continue;
    }
    if (event.type === "assistant_message" && !messageIds.includes(event.messageId)) {
      messageIds.push(event.messageId);
    }
  }
  return messageIds;
};

describe("Claude live and hydrated transcript parity", () => {
  test("keeps one response identity for split tool-use reasoning, text, and tool snapshots", () => {
    const responseId = "response-tool-use";
    const reasoningMessage = claudeSdkMessageFixture({
      type: "assistant",
      uuid: "f83a194a-6771-410e-8c1c-0ed6db1decc4",
      session_id: "session-1",
      parent_tool_use_id: null,
      timestamp,
      message: {
        id: responseId,
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [{ type: "thinking", thinking: "Planning notification synchronization" }],
        stop_reason: "tool_use",
      },
    });
    const draftMessage = claudeSdkMessageFixture({
      type: "assistant",
      uuid: "f4cd7533-bbf3-4aab-85a3-bffa0401de15",
      session_id: "session-1",
      parent_tool_use_id: null,
      timestamp,
      message: {
        id: responseId,
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "I’m waiting for both review passes." }],
        stop_reason: "tool_use",
      },
    });
    const toolMessage = claudeSdkMessageFixture({
      type: "assistant",
      uuid: "517ccd53-f177-4742-8bcc-883c955e3824",
      session_id: "session-1",
      parent_tool_use_id: null,
      timestamp: resultTimestamp,
      message: {
        id: responseId,
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [
          {
            type: "tool_use",
            id: "tool-output",
            name: "TaskOutput",
            input: { task_id: "reviewer", block: true },
          },
        ],
        stop_reason: "tool_use",
      },
    });
    const liveEvents: AgentEvent[] = [];
    const liveSession = createEventTestSession();
    const modelSelection = (model: string) => ({
      providerId: "claude",
      modelId: model,
      runtimeKind: "claude" as const,
    });
    const emit = (event: AgentEvent) => liveEvents.push(event);

    for (const message of [
      claudeSdkMessageFixture({
        type: "stream_event",
        uuid: "6ce3843d-c6b6-412e-8f23-b7dc7ec12556",
        session_id: "session-1",
        parent_tool_use_id: null,
        event: { type: "message_start", message: { id: responseId } },
      }),
      claudeSdkMessageFixture({
        type: "stream_event",
        uuid: "1c15751a-b263-4e6e-833e-69e3a3272c2b",
        session_id: "session-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "Planning notification synchronization" },
        },
      }),
      claudeSdkMessageFixture({
        type: "stream_event",
        uuid: "16e17345-9bd0-44a0-8c1f-79b02ce9d5e2",
        session_id: "session-1",
        parent_tool_use_id: null,
        event: { type: "content_block_stop", index: 0 },
      }),
      reasoningMessage,
      claudeSdkMessageFixture({
        type: "stream_event",
        uuid: "167da0e2-353c-4fa3-869d-647d8e00b881",
        session_id: "session-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 1,
          delta: { type: "text_delta", text: "I’m waiting for both review passes." },
        },
      }),
      draftMessage,
      toolMessage,
    ]) {
      handleClaudeSdkMessage({
        emit,
        message,
        modelSelection,
        session: liveSession,
        timestamp,
      });
    }

    expect(liveEvents).toContainEqual(
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          kind: "reasoning",
          messageId: responseId,
          text: "Planning notification synchronization",
        }),
      }),
    );
    expect(liveEvents).toContainEqual(
      expect.objectContaining({
        type: "assistant_delta",
        messageId: responseId,
        delta: "I’m waiting for both review passes.",
      }),
    );
    expect(liveEvents).toContainEqual(
      expect.objectContaining({
        type: "assistant_part",
        part: expect.objectContaining({
          kind: "tool",
          messageId: responseId,
          callId: "tool-output",
        }),
      }),
    );
    expect(liveEvents.some((event) => event.type === "assistant_message")).toBe(false);

    const hydratedMessages = toClaudeHistoryMessages(
      claudeHistoryMessageFixtures([reasoningMessage, draftMessage, toolMessage]),
      () => resultTimestamp,
    ).filter((message) => message.role === "assistant");
    expect(hydratedMessages).toHaveLength(1);
    expect(hydratedMessages[0]).toMatchObject({
      messageId: responseId,
      text: "I’m waiting for both review passes.",
    });
    expect(hydratedMessages[0]?.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "reasoning",
          messageId: responseId,
          text: "Planning notification synchronization",
        }),
        expect.objectContaining({
          kind: "tool",
          messageId: responseId,
          callId: "tool-output",
        }),
      ]),
    );
  });

  test("shows parent intermediate assistant snapshots in both live and hydrated transcripts", () => {
    const draftMessage = claudeSdkMessageFixture({
      type: "assistant",
      uuid: "f4cd7533-bbf3-4aab-85a3-bffa0401de15",
      session_id: "session-1",
      parent_tool_use_id: null,
      timestamp,
      message: {
        id: "response-draft",
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [
          { type: "thinking", thinking: "Planning notification synchronization" },
          {
            type: "text",
            text: "I’m waiting for both review passes before I give a combined result.",
          },
        ],
        stop_reason: null,
      },
    });
    const liveEvents: AgentEvent[] = [];

    handleClaudeSdkMessage({
      emit: (event) => liveEvents.push(event),
      message: draftMessage,
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      session: createEventTestSession(),
      timestamp,
    });

    expect(
      liveEvents.flatMap((event) => (event.type === "assistant_part" ? [event.part] : [])),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "reasoning",
          messageId: "response-draft",
          text: "Planning notification synchronization",
        }),
        expect.objectContaining({
          kind: "text",
          messageId: "response-draft",
          text: "I’m waiting for both review passes before I give a combined result.",
        }),
      ]),
    );
    expect(liveEvents.some((event) => event.type === "assistant_message")).toBe(false);

    const hydratedAssistantMessages = toClaudeHistoryMessages(
      [claudeSessionMessageFixture(draftMessage)],
      () => timestamp,
    ).filter((message) => message.role === "assistant");
    expect(hydratedAssistantMessages).toHaveLength(1);
    expect(hydratedAssistantMessages[0]).toMatchObject({
      messageId: "response-draft",
      text: "I’m waiting for both review passes before I give a combined result.",
    });
    expect(hydratedAssistantMessages[0]?.parts).toContainEqual(
      expect.objectContaining({
        kind: "reasoning",
        messageId: "response-draft",
        text: "Planning notification synchronization",
      }),
    );
  });

  test("does not expose Claude synthetic messages in live subagent transcripts", () => {
    const liveEvents: AgentEvent[] = [];
    const liveSession = createEventTestSession();
    liveSession.subagentTaskIdsByToolUseId.set("agent-tool", "agent-task");
    const emit = (event: AgentEvent) => liveEvents.push(event);
    const modelSelection = (model: string) => ({
      providerId: "claude",
      modelId: model,
      runtimeKind: "claude" as const,
    });

    for (const message of [
      claudeSdkMessageFixture({
        type: "user",
        uuid: "1532e5b7-a06e-4344-8227-17bfbedfbb54",
        session_id: "session-1",
        parent_tool_use_id: "agent-tool",
        message: { role: "user", content: "Inspect the authentication flow." },
      }),
      claudeSdkMessageFixture({
        type: "user",
        uuid: "1a275b20-f4ab-433f-8d94-e42926d03eb1",
        session_id: "session-1",
        parent_tool_use_id: "agent-tool",
        isSynthetic: true,
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text: "Base directory for this skill: /Users/example/.claude/skills/explore",
            },
          ],
        },
      }),
    ]) {
      handleClaudeSdkMessage({
        emit,
        message,
        modelSelection,
        session: liveSession,
        timestamp,
      });
    }

    expect(
      liveEvents.flatMap((event) => (event.type === "user_message" ? [event.message] : [])),
    ).toEqual(["Inspect the authentication flow."]);
  });

  test("shows only human user messages in live and hydrated subagent transcripts", () => {
    const parentToolUseId = "agent-tool";
    const liveEvents: AgentEvent[] = [];
    const liveSession = createEventTestSession();
    liveSession.subagentTaskIdsByToolUseId.set(parentToolUseId, "agent-task");
    const userMessages = [
      claudeSdkMessageFixture({
        type: "user",
        uuid: "1532e5b7-a06e-4344-8227-17bfbedfbb54",
        session_id: "session-1",
        parent_tool_use_id: parentToolUseId,
        message: { role: "user", content: "Inspect the authentication flow." },
      }),
      claudeSdkMessageFixture({
        type: "user",
        uuid: "5cb178e8-e869-4c2b-8c56-4dd20703b598",
        session_id: "session-1",
        parent_tool_use_id: parentToolUseId,
        origin: { kind: "peer", from: "reviewer" },
        message: { role: "user", content: "The reviewer finished." },
      }),
      claudeSdkMessageFixture({
        type: "user",
        uuid: "73533a65-2712-442b-8a37-4eb5209c6095",
        session_id: "session-1",
        parent_tool_use_id: parentToolUseId,
        shouldQuery: false,
        message: { role: "user", content: "Context for the next query." },
      }),
    ];

    for (const message of userMessages) {
      handleClaudeSdkMessage({
        emit: (event) => liveEvents.push(event),
        message,
        modelSelection: (model) => ({
          providerId: "claude",
          modelId: model,
          runtimeKind: "claude",
        }),
        session: liveSession,
        timestamp,
      });
    }

    expect(
      liveEvents.flatMap((event) => (event.type === "user_message" ? [event.message] : [])),
    ).toEqual(["Inspect the authentication flow."]);

    const hydratedUserMessages = toClaudeHistoryMessages(
      userMessages.map((message) =>
        claudeSessionMessageFixture({ ...message, parent_tool_use_id: null }),
      ),
      () => timestamp,
      [],
      {
        includeNestedEntries: true,
        transcriptExternalSessionId: "session-1::claude-subagent::agent-task",
      },
    ).filter((message) => message.role === "user");
    expect(hydratedUserMessages.map((message) => message.text)).toEqual([
      "Inspect the authentication flow.",
    ]);
  });

  test("keeps the streamed response identity when the SDK assistant snapshot precedes message stop", () => {
    const responseId = "response-final";
    const assistantUuid = "fdb2ba12-c9c6-4ba4-8111-f2f6b32c4d68";
    const finalText = "Complete final answer";
    const liveEvents: AgentEvent[] = [];
    const liveSession = createEventTestSession();
    liveSession.acceptedUserMessages.push({});
    liveSession.pendingUserTurnCount = 1;
    const emit = (event: AgentEvent) => liveEvents.push(event);
    const modelSelection = (model: string) => ({
      providerId: "claude",
      modelId: model,
      runtimeKind: "claude" as const,
    });

    handleClaudeSdkMessage({
      emit,
      message: claudeSdkMessageFixture({
        type: "stream_event",
        uuid: "d8cf5013-a295-46e6-868e-a85373bb2a64",
        session_id: "session-1",
        parent_tool_use_id: null,
        event: {
          type: "message_start",
          message: {
            id: responseId,
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4-6",
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: {
              input_tokens: 0,
              output_tokens: 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          },
        },
      }),
      modelSelection,
      session: liveSession,
      timestamp,
    });
    handleClaudeSdkMessage({
      emit,
      message: claudeSdkMessageFixture({
        type: "stream_event",
        uuid: "cd9f5256-a9b7-4856-85e2-f1d32ad0fe55",
        session_id: "session-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: finalText },
        },
      }),
      modelSelection,
      session: liveSession,
      timestamp,
    });
    handleClaudeSdkMessage({
      emit,
      message: claudeSdkMessageFixture({
        type: "assistant",
        uuid: assistantUuid,
        session_id: "session-1",
        parent_tool_use_id: null,
        message: {
          id: responseId,
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: finalText }],
          stop_reason: null,
        },
      }),
      modelSelection,
      session: liveSession,
      timestamp: resultTimestamp,
    });

    expect(liveEvents.some((event) => event.type === "transcript_retracted")).toBe(false);

    handleClaudeSdkMessage({
      emit,
      message: claudeSdkMessageFixture({
        type: "result",
        subtype: "success",
        uuid: "5a9ed4b6-bec0-4fef-8758-4a0bee7322ab",
        session_id: "session-1",
        is_error: false,
        result: finalText,
        stop_reason: "end_turn",
        terminal_reason: "completed",
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
      modelSelection,
      session: liveSession,
      timestamp: resultTimestamp,
    });

    expect(
      liveEvents
        .filter((event) => event.type === "assistant_delta" || event.type === "assistant_message")
        .map((event) => event.messageId),
    ).toEqual([responseId, responseId]);
    expect(retainedLiveAssistantMessageIds(liveEvents)).toEqual([responseId]);

    const storedAssistantMessage = claudeSdkMessageFixture({
      type: "assistant",
      uuid: assistantUuid,
      session_id: "session-1",
      parent_tool_use_id: null,
      message: {
        id: responseId,
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: finalText }],
        stop_reason: "end_turn",
      },
    });
    const hydratedAssistantMessages = toClaudeHistoryMessages(
      [claudeSessionMessageFixture(storedAssistantMessage)],
      () => resultTimestamp,
    ).filter((message) => message.role === "assistant");
    expect(hydratedAssistantMessages).toHaveLength(1);
    expect(hydratedAssistantMessages[0]).toMatchObject({
      messageId: responseId,
      text: finalText,
    });
  });

  test("keeps one response identity for subagent finals without a stop reason", () => {
    const responseId = "subagent-response-final";
    const assistantUuid = "8f432c05-271b-4937-8663-2b01901015ca";
    const parentToolUseId = "agent-tool";
    const finalText = "Complete child response";
    const liveEvents: AgentEvent[] = [];
    const liveSession = createEventTestSession();
    liveSession.subagentTaskIdsByToolUseId.set(parentToolUseId, "agent-task");
    const emit = (event: AgentEvent) => liveEvents.push(event);
    const modelSelection = (model: string) => ({
      providerId: "claude",
      modelId: model,
      runtimeKind: "claude" as const,
    });

    for (const message of [
      claudeSdkMessageFixture({
        type: "assistant",
        uuid: assistantUuid,
        session_id: "session-1",
        parent_tool_use_id: parentToolUseId,
        message: {
          id: responseId,
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: finalText }],
          stop_reason: null,
        },
      }),
      claudeSdkMessageFixture({
        type: "system",
        subtype: "task_notification",
        uuid: "69b3c7e6-0266-4105-8b6a-e30e8def797d",
        session_id: "session-1",
        task_id: "agent-task",
        tool_use_id: parentToolUseId,
        status: "completed",
        output_file: "/tmp/agent-task.output",
        summary: "Task completed",
      }),
    ]) {
      handleClaudeSdkMessage({
        emit,
        message,
        modelSelection,
        session: liveSession,
        timestamp: resultTimestamp,
      });
    }

    expect(
      liveEvents
        .filter((event) => event.type === "assistant_delta" || event.type === "assistant_message")
        .map((event) => event.messageId),
    ).toEqual([responseId]);
    expect(liveEvents.some((event) => event.type === "transcript_retracted")).toBe(false);

    const hydratedAssistantMessages = toClaudeHistoryMessages(
      [
        claudeSessionMessageFixture(
          claudeSdkMessageFixture({
            type: "assistant",
            uuid: assistantUuid,
            session_id: "session-1",
            parent_tool_use_id: parentToolUseId,
            message: {
              id: responseId,
              role: "assistant",
              model: "claude-sonnet-4-6",
              content: [{ type: "text", text: finalText }],
              stop_reason: null,
            },
          }),
        ),
      ],
      () => resultTimestamp,
      [],
      {
        includeNestedEntries: true,
        transcriptExternalSessionId: "session-1::claude-subagent::agent-task",
      },
    ).filter((message) => message.role === "assistant");

    expect(hydratedAssistantMessages).toHaveLength(1);
    expect(hydratedAssistantMessages[0]).toMatchObject({
      messageId: responseId,
      text: finalText,
    });
  });

  test("keeps only the latest completed snapshot for one Claude response", () => {
    const responseId = "response-final";
    const firstSnapshot = claudeSdkMessageFixture({
      type: "assistant",
      uuid: "fc54d86f-8e3c-4a70-8e38-94e7952656df",
      session_id: "session-1",
      parent_tool_use_id: null,
      timestamp,
      message: {
        id: responseId,
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "First completed snapshot" }],
        stop_reason: "end_turn",
      },
    });
    const finalSnapshot = claudeSdkMessageFixture({
      type: "assistant",
      uuid: "fdb2ba12-c9c6-4ba4-8111-f2f6b32c4d68",
      session_id: "session-1",
      parent_tool_use_id: null,
      timestamp: resultTimestamp,
      message: {
        id: responseId,
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "Authoritative final snapshot" }],
        stop_reason: "end_turn",
      },
    });
    const liveEvents: AgentEvent[] = [];
    const liveSession = createEventTestSession();
    const emit = (event: AgentEvent) => liveEvents.push(event);
    const modelSelection = (model: string) => ({
      providerId: "claude",
      modelId: model,
      runtimeKind: "claude" as const,
    });

    handleClaudeSdkMessage({
      emit,
      message: firstSnapshot,
      modelSelection,
      session: liveSession,
      timestamp,
    });
    handleClaudeSdkMessage({
      emit,
      message: finalSnapshot,
      modelSelection,
      session: liveSession,
      timestamp: resultTimestamp,
    });

    expect(retainedLiveAssistantMessageIds(liveEvents)).toEqual([responseId]);
    expect(liveEvents.filter((event) => event.type === "assistant_message").at(-1)).toMatchObject({
      messageId: responseId,
      message: "Authoritative final snapshot",
    });

    const hydratedAssistantMessages = toClaudeHistoryMessages(
      claudeHistoryMessageFixtures([firstSnapshot, finalSnapshot]),
      () => resultTimestamp,
    ).filter((message) => message.role === "assistant");
    expect(hydratedAssistantMessages).toHaveLength(1);
    expect(hydratedAssistantMessages[0]).toMatchObject({
      messageId: responseId,
      text: "Authoritative final snapshot",
    });
  });

  test("keeps one transcript identity across streamed and split completed assistant messages", () => {
    const responseId = "response-final";
    const reasoningMessage = claudeSdkMessageFixture({
      type: "assistant",
      uuid: "f83a194a-6771-410e-8c1c-0ed6db1decc4",
      session_id: "session-1",
      parent_tool_use_id: null,
      timestamp,
      message: {
        id: responseId,
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [{ type: "thinking", thinking: "Short thought" }],
        stop_reason: "end_turn",
      },
    });
    const finalMessage = claudeSdkMessageFixture({
      type: "assistant",
      uuid: "fdb2ba12-c9c6-4ba4-8111-f2f6b32c4d68",
      session_id: "session-1",
      parent_tool_use_id: null,
      timestamp: resultTimestamp,
      message: {
        id: responseId,
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "Complete final answer" }],
        stop_reason: "end_turn",
      },
    });
    const liveEvents: AgentEvent[] = [];
    const liveSession = createEventTestSession();
    liveSession.acceptedUserMessages.push({});
    liveSession.pendingUserTurnCount = 1;
    const emit = (event: AgentEvent) => liveEvents.push(event);
    const modelSelection = (model: string) => ({
      providerId: "claude",
      modelId: model,
      runtimeKind: "claude" as const,
    });

    handleClaudeSdkMessage({
      emit,
      message: claudeSdkMessageFixture({
        type: "stream_event",
        uuid: "d8cf5013-a295-46e6-868e-a85373bb2a64",
        session_id: "session-1",
        parent_tool_use_id: null,
        event: {
          type: "message_start",
          message: {
            id: responseId,
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4-6",
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: {
              input_tokens: 0,
              output_tokens: 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          },
        },
      }),
      modelSelection,
      session: liveSession,
      timestamp,
    });
    handleClaudeSdkMessage({
      emit,
      message: claudeSdkMessageFixture({
        type: "stream_event",
        uuid: "1f1b772a-5e50-47fa-87bd-30e1e0f4f8bd",
        session_id: "session-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "Short thought" },
        },
      }),
      modelSelection,
      session: liveSession,
      timestamp,
    });
    handleClaudeSdkMessage({
      emit,
      message: claudeSdkMessageFixture({
        type: "stream_event",
        uuid: "be9e7254-60f3-4f79-8201-9555c1ac31cb",
        session_id: "session-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_stop",
          index: 0,
        },
      }),
      modelSelection,
      session: liveSession,
      timestamp,
    });
    handleClaudeSdkMessage({
      emit,
      message: claudeSdkMessageFixture({
        type: "stream_event",
        uuid: "1e27aec1-052b-4343-8394-eda1afd891dc",
        session_id: "session-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 1,
          delta: { type: "text_delta", text: "Complete final answer" },
        },
      }),
      modelSelection,
      session: liveSession,
      timestamp,
    });
    handleClaudeSdkMessage({
      emit,
      message: reasoningMessage,
      modelSelection,
      session: liveSession,
      timestamp,
    });

    expect(
      liveEvents.flatMap<{ type: string; messageId: string }>((event) => {
        if (event.type === "assistant_part" && event.part.kind === "reasoning") {
          return [{ type: event.type, messageId: event.part.messageId }];
        }
        if (event.type === "assistant_delta") {
          return [{ type: event.type, messageId: event.messageId ?? "" }];
        }
        return [];
      }),
    ).toEqual([
      { type: "assistant_part", messageId: responseId },
      { type: "assistant_delta", messageId: responseId },
      { type: "assistant_part", messageId: responseId },
    ]);
    expect(liveEvents.some((event) => event.type === "transcript_retracted")).toBe(false);

    handleClaudeSdkMessage({
      emit,
      message: finalMessage,
      modelSelection,
      session: liveSession,
      timestamp: resultTimestamp,
    });

    expect(
      liveEvents
        .filter((event) => event.type === "assistant_delta" || event.type === "assistant_message")
        .map((event) => event.messageId),
    ).toEqual([responseId, responseId]);
    expect(
      liveEvents
        .filter(
          (event) => event.type === "assistant_message" || event.type === "transcript_retracted",
        )
        .map((event) => event.type),
    ).toEqual(["assistant_message"]);
    expect(retainedLiveAssistantMessageIds(liveEvents)).toEqual([responseId]);

    const hydratedAssistantMessages = toClaudeHistoryMessages(
      claudeHistoryMessageFixtures([reasoningMessage, finalMessage]),
      () => resultTimestamp,
    ).filter((message) => message.role === "assistant");
    expect(hydratedAssistantMessages).toHaveLength(1);
    expect(hydratedAssistantMessages[0]).toMatchObject({
      messageId: responseId,
      text: "Complete final answer",
    });
    expect(
      hydratedAssistantMessages[0]?.parts.flatMap((part) =>
        part.kind === "reasoning" ? [part.text] : [],
      ),
    ).toEqual(["Short thought"]);
  });

  test("reconciles streamed assistant text to the hydrated SDK message id", () => {
    const sdkMessage = claudeSdkMessageFixture({
      type: "assistant",
      uuid: "fdb2ba12-c9c6-4ba4-8111-f2f6b32c4d68",
      session_id: "session-1",
      parent_tool_use_id: null,
      timestamp,
      message: {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "Final answer" }],
        stop_reason: "end_turn",
      },
    });
    const liveEvents: AgentEvent[] = [];
    const liveSession = createEventTestSession();
    liveSession.acceptedUserMessages.push({});
    liveSession.pendingUserTurnCount = 1;

    handleClaudeSdkMessage({
      emit: (event) => liveEvents.push(event),
      message: claudeSdkMessageFixture({
        type: "stream_event",
        uuid: "1e27aec1-052b-4343-8394-eda1afd891dc",
        session_id: "session-1",
        parent_tool_use_id: null,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Final answer" },
        },
      }),
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      session: liveSession,
      timestamp,
    });
    handleClaudeSdkMessage({
      emit: (event) => liveEvents.push(event),
      message: sdkMessage,
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      session: liveSession,
      timestamp,
    });

    const hydratedIds = toClaudeHistoryMessages(
      [claudeSessionMessageFixture(sdkMessage)],
      () => timestamp,
    ).map((message) => message.messageId);
    expect(retainedLiveAssistantMessageIds(liveEvents)).toEqual(hydratedIds);
    expect(hydratedIds).toEqual(["fdb2ba12-c9c6-4ba4-8111-f2f6b32c4d68"]);
  });

  test("projects assistant content blocks through the same canonical parts", () => {
    const content = [
      { type: "thinking", thinking: "Inspecting" },
      { type: "text", text: "I will inspect the file." },
      {
        type: "tool_use",
        id: "tool-read-1",
        name: "Read",
        input: { file_path: "/repo/file.ts" },
      },
      { type: "text", text: "Then I will summarize it." },
    ] as const;
    const sdkMessage = claudeSdkMessageFixture({
      type: "assistant",
      uuid: "c5aa776f-2893-4045-8a61-140a5912a032",
      session_id: "session-1",
      parent_tool_use_id: null,
      timestamp,
      message: {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content,
        stop_reason: "tool_use",
      },
    });
    const liveEvents: AgentEvent[] = [];

    handleClaudeSdkMessage({
      emit: (event) => liveEvents.push(event),
      message: sdkMessage,
      modelSelection: (model) => ({
        providerId: "claude",
        modelId: model,
        runtimeKind: "claude",
      }),
      session: createEventTestSession(),
      timestamp,
    });
    const history = toClaudeHistoryMessages(
      [claudeSessionMessageFixture(sdkMessage)],
      () => timestamp,
    );
    const hydratedAssistant = history.find((message) => message.role === "assistant");
    expect(hydratedAssistant).toBeDefined();
    if (!hydratedAssistant) {
      throw new Error("Expected hydrated assistant message.");
    }

    expect(assistantParts(liveEvents)).toEqual(hydratedAssistant.parts);
  });

  test("projects completed and failed tool results through the same canonical part", () => {
    const cases = [
      { isError: false, text: "file contents", tool: "Read" },
      { isError: true, text: "command failed", tool: "Bash" },
    ] as const;

    for (const [index, testCase] of cases.entries()) {
      const toolUseId = `tool-${index}`;
      const assistantMessageId = claudeSdkMessageUuidFixture(`assistant-${index}`);
      const input =
        testCase.tool === "Read" ? { file_path: "/repo/file.ts" } : { command: "exit 1" };
      const assistantMessage = claudeSdkMessageFixture({
        type: "assistant",
        uuid: assistantMessageId,
        session_id: "session-1",
        timestamp,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: toolUseId,
              name: testCase.tool,
              input,
            },
          ],
          stop_reason: "tool_use",
        },
        parent_tool_use_id: null,
      });
      const resultMessage = claudeSdkMessageFixture({
        type: "user",
        uuid: claudeSdkMessageUuidFixture(`result-${index}`),
        session_id: "session-1",
        parent_tool_use_id: toolUseId,
        timestamp: resultTimestamp,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolUseId,
              content: testCase.text,
              is_error: testCase.isError,
            },
          ],
        },
      });
      const history = toClaudeHistoryMessages(
        [claudeSessionMessageFixture(assistantMessage), claudeSessionMessageFixture(resultMessage)],
        () => resultTimestamp,
      );
      const hydratedAssistant = history.find((message) => message.role === "assistant");
      const historyPart = hydratedAssistant?.parts.find(
        (part) => part.kind === "tool" && part.callId === toolUseId,
      );
      const liveEvents: AgentEvent[] = [];
      const liveSession = createEventTestSession();
      liveSession.toolInputsByCallId.set(toolUseId, input);
      liveSession.toolMessageIdsByCallId.set(toolUseId, assistantMessageId);
      liveSession.toolNamesByCallId.set(toolUseId, testCase.tool);

      handleClaudeUserToolResultMessage({
        emit: (event) => liveEvents.push(event),
        message: resultMessage,
        session: liveSession,
        timestamp: resultTimestamp,
      });

      expect(assistantParts(liveEvents)[0]).toEqual(historyPart);
    }
  });

  test("projects every tool result block through the live and hydrated paths", () => {
    const toolUses = [
      {
        id: "tool-read",
        name: "Read",
        input: { file_path: "/repo/file.ts" },
        result: "file contents",
      },
      {
        id: "tool-bash",
        name: "Bash",
        input: { command: "pwd" },
        result: "/repo",
      },
    ] as const;
    const assistantMessage = claudeSdkMessageFixture({
      type: "assistant",
      uuid: "ef52161c-2436-476b-8fa0-f4fc1aa35cfa",
      session_id: "session-1",
      timestamp,
      message: {
        role: "assistant",
        content: toolUses.map((toolUse) => ({
          type: "tool_use",
          id: toolUse.id,
          name: toolUse.name,
          input: toolUse.input,
        })),
        stop_reason: "tool_use",
      },
      parent_tool_use_id: null,
    });
    const resultMessage = claudeSdkMessageFixture({
      type: "user",
      uuid: "424192cd-2d58-4d7f-81c1-160699671642",
      session_id: "session-1",
      parent_tool_use_id: null,
      timestamp: resultTimestamp,
      message: {
        role: "user",
        content: toolUses.map((toolUse) => ({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: toolUse.result,
          is_error: false,
        })),
      },
    });
    const history = toClaudeHistoryMessages(
      [claudeSessionMessageFixture(assistantMessage), claudeSessionMessageFixture(resultMessage)],
      () => resultTimestamp,
    );
    const hydratedToolParts =
      history
        .find((message) => message.role === "assistant")
        ?.parts.filter((part) => part.kind === "tool") ?? [];
    const liveEvents: AgentEvent[] = [];
    const liveSession = createEventTestSession();
    for (const toolUse of toolUses) {
      liveSession.toolInputsByCallId.set(toolUse.id, toolUse.input);
      liveSession.toolMessageIdsByCallId.set(toolUse.id, "ef52161c-2436-476b-8fa0-f4fc1aa35cfa");
      liveSession.toolNamesByCallId.set(toolUse.id, toolUse.name);
    }

    handleClaudeUserToolResultMessage({
      emit: (event) => liveEvents.push(event),
      message: resultMessage,
      session: liveSession,
      timestamp: resultTimestamp,
    });

    expect(assistantParts(liveEvents)).toEqual(hydratedToolParts);
    expect(
      assistantParts(liveEvents).flatMap((part) => (part.kind === "tool" ? [part.callId] : [])),
    ).toEqual(["tool-read", "tool-bash"]);
  });

  test("releases completed tool input and timing metadata", () => {
    const resultMessage = claudeSdkMessageFixture({
      type: "user",
      uuid: "828ec510-6423-4691-80cb-9cdaaa1b82e7",
      session_id: "session-1",
      parent_tool_use_id: "tool-read",
      timestamp: resultTimestamp,
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-read",
            content: "file contents",
            is_error: false,
          },
        ],
      },
    });
    const liveSession = {
      ...createEventTestSession(),
      toolEndedAtMsByCallId: new Map<string, number>(),
    };
    liveSession.toolInputsByCallId.set("tool-read", { file_path: "/repo/file.ts" });
    liveSession.toolMessageIdsByCallId.set("tool-read", "assistant-read");
    liveSession.toolNamesByCallId.set("tool-read", "Read");
    liveSession.toolStartedAtMsByCallId.set("tool-read", Date.parse(timestamp));
    liveSession.toolEndedAtMsByCallId.set("tool-read", Date.parse(resultTimestamp));

    handleClaudeUserToolResultMessage({
      emit: () => {},
      message: resultMessage,
      session: liveSession,
      timestamp: resultTimestamp,
    });

    expect(liveSession.toolInputsByCallId.has("tool-read")).toBe(false);
    expect(liveSession.toolStartedAtMsByCallId.has("tool-read")).toBe(false);
    expect(liveSession.toolEndedAtMsByCallId.has("tool-read")).toBe(false);
    expect(liveSession.toolMessageIdsByCallId.get("tool-read")).toBe("assistant-read");
    expect(liveSession.toolNamesByCallId.get("tool-read")).toBe("Read");
  });

  test("preserves file-reference display parts across live send and hydrated history", async () => {
    const parts: AgentUserMessagePart[] = [
      { kind: "text", text: "Inspect " },
      {
        kind: "file_reference",
        file: {
          id: "docs/My File.md",
          path: "docs/My File.md",
          name: "My File.md",
          kind: "default",
        },
      },
    ];
    const session = createClaudeSession();
    const accepted = await sendClaudeUserMessage({
      emit: () => {},
      messageInput: {
        repoPath: "/repo",
        runtimeKind: "claude",
        runtimePolicy: { kind: "claude" },
        workingDirectory: "/repo",
        externalSessionId: "session-1",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
        parts,
      },
      now: () => timestamp,
      randomId: () => STRUCTURED_USER_MESSAGE_ID,
      session,
    });
    const sdkMessage = await toClaudeMessageFromParts(parts);
    const hydrated = toClaudeHistoryMessages(
      [
        claudeSessionMessageFixture({
          ...sdkMessage,
          uuid: accepted.messageId,
          session_id: "session-1",
          timestamp,
        }),
      ],
      () => timestamp,
    );
    const hydratedUserMessage = hydrated.find((message) => message.role === "user");
    if (hydratedUserMessage?.role !== "user") {
      throw new Error("Expected a hydrated user message.");
    }

    expect(accepted.parts).toEqual(hydratedUserMessage.displayParts);
  });

  test("applies assistant retractions consistently in live and hydrated projections", () => {
    const originalMessage = claudeSdkMessageFixture({
      type: "assistant",
      uuid: "b2423a99-7e50-4569-845b-e998b89e75c2",
      session_id: "session-1",
      parent_tool_use_id: null,
      message: {
        role: "assistant",
        model: "claude-opus-4-6",
        content: [{ type: "text", text: "Refused response" }],
        stop_reason: "end_turn",
      },
    });
    const replacementMessage = claudeSdkMessageFixture({
      type: "assistant",
      uuid: "f6c5a317-763d-49aa-89d0-ebf255d070e2",
      session_id: "session-1",
      parent_tool_use_id: null,
      supersedes: ["b2423a99-7e50-4569-845b-e998b89e75c2"],
      message: {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "Canonical response" }],
        stop_reason: "end_turn",
      },
    });
    const liveEvents: AgentEvent[] = [];
    const liveSession = createEventTestSession();
    const emit = (event: AgentEvent) => liveEvents.push(event);
    const modelSelection = (model: string) => ({
      providerId: "claude",
      modelId: model,
      runtimeKind: "claude" as const,
    });

    handleClaudeSdkMessage({
      emit,
      message: originalMessage,
      modelSelection,
      session: liveSession,
      timestamp,
    });
    handleClaudeSdkMessage({
      emit,
      message: replacementMessage,
      modelSelection,
      session: liveSession,
      timestamp: resultTimestamp,
    });
    const hydratedIds = toClaudeHistoryMessages(
      [
        claudeSessionMessageFixture(originalMessage),
        claudeSessionMessageFixture(replacementMessage),
      ],
      () => resultTimestamp,
    )
      .filter((message) => message.role === "assistant")
      .map((message) => message.messageId);

    expect(retainedLiveAssistantMessageIds(liveEvents)).toEqual(hydratedIds);
    expect(hydratedIds).toEqual(["f6c5a317-763d-49aa-89d0-ebf255d070e2"]);
  });

  test("does not resurrect retracted subagents when late task events arrive", () => {
    const toolUseMessage = claudeSdkMessageFixture({
      type: "assistant",
      uuid: "6b062bc2-d87a-4e55-8e5e-a4221b4616a1",
      session_id: "session-1",
      parent_tool_use_id: null,
      timestamp,
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-agent-retracted",
            name: "Agent",
            input: {
              description: "Inspect auth",
              prompt: "Inspect the authentication flow",
              subagent_type: "Explore",
            },
          },
        ],
        stop_reason: "tool_use",
      },
    });
    const taskStarted = claudeSdkMessageFixture({
      type: "system",
      subtype: "task_started",
      uuid: "00000000-0000-4000-8000-000000000006",
      session_id: "session-1",
      task_id: "task-retracted",
      tool_use_id: "tool-agent-retracted",
      description: "Inspect auth",
      prompt: "Inspect the authentication flow",
      subagent_type: "Explore",
    });
    const replacementMessage = claudeSdkMessageFixture({
      type: "assistant",
      uuid: "8882642a-fe7a-43ec-81b3-18266b6c7841",
      session_id: "session-1",
      parent_tool_use_id: null,
      supersedes: ["6b062bc2-d87a-4e55-8e5e-a4221b4616a1"],
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Continuing without that subagent." }],
        stop_reason: "end_turn",
      },
    });
    const lateTaskNotification = claudeSdkMessageFixture({
      type: "system",
      subtype: "task_notification",
      uuid: "00000000-0000-4000-8000-000000000007",
      session_id: "session-1",
      task_id: "task-retracted",
      status: "completed",
      output_file: "/tmp/task-retracted.output",
      summary: "Late completion",
    });
    const liveEvents: AgentEvent[] = [];
    const liveSession = createEventTestSession();
    const emit = (event: AgentEvent) => liveEvents.push(event);
    const modelSelection = (model: string) => ({
      providerId: "claude",
      modelId: model,
      runtimeKind: "claude" as const,
    });

    for (const [message, eventTimestamp] of [
      [toolUseMessage, timestamp],
      [taskStarted, timestamp],
      [replacementMessage, resultTimestamp],
    ] as const) {
      handleClaudeSdkMessage({
        emit,
        message,
        modelSelection,
        session: liveSession,
        timestamp: eventTimestamp,
      });
    }
    const eventCountBeforeLateNotification = liveEvents.length;
    handleClaudeSdkMessage({
      emit,
      message: lateTaskNotification,
      modelSelection,
      session: liveSession,
      timestamp: resultTimestamp,
    });

    expect(liveEvents.slice(eventCountBeforeLateNotification)).toEqual([]);
    const hydrated = toClaudeHistoryMessages(
      claudeHistoryMessageFixtures([
        toolUseMessage,
        taskStarted,
        replacementMessage,
        lateTaskNotification,
      ]),
      () => resultTimestamp,
    );
    expect(
      hydrated.flatMap((message) => message.parts).filter((part) => part.kind === "subagent"),
    ).toEqual([]);
    expect(hydrated.map((message) => message.messageId)).toEqual([
      "8882642a-fe7a-43ec-81b3-18266b6c7841",
    ]);
  });

  test("does not resurrect retracted tools when late results arrive", () => {
    const toolUseMessage = claudeSdkMessageFixture({
      type: "assistant",
      uuid: "329afb68-2fa7-4226-8733-1b9f1e3a2389",
      session_id: "session-1",
      parent_tool_use_id: null,
      timestamp,
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-read-retracted",
            name: "Read",
            input: { file_path: "src/index.ts" },
          },
        ],
        stop_reason: "tool_use",
      },
    });
    const replacementMessage = claudeSdkMessageFixture({
      type: "assistant",
      uuid: "dadc8578-068b-4907-8c19-a14791e1cfb9",
      session_id: "session-1",
      parent_tool_use_id: null,
      supersedes: ["329afb68-2fa7-4226-8733-1b9f1e3a2389"],
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Continuing without that read." }],
        stop_reason: "end_turn",
      },
    });
    const lateToolResult = claudeSdkMessageFixture({
      type: "user",
      uuid: "2560bccc-5f5c-4010-8a00-81bc5ec55ce6",
      session_id: "session-1",
      parent_tool_use_id: "tool-read-retracted",
      timestamp: resultTimestamp,
      tool_use_result: {
        type: "tool_result",
        tool_use_id: "tool-read-retracted",
        tool_name: "Read",
        content: [{ type: "text", text: "Late file contents" }],
      },
      message: { role: "user", content: [] },
    });
    const liveEvents: AgentEvent[] = [];
    const liveSession = createEventTestSession();
    const emit = (event: AgentEvent) => liveEvents.push(event);
    const modelSelection = (model: string) => ({
      providerId: "claude",
      modelId: model,
      runtimeKind: "claude" as const,
    });

    handleClaudeSdkMessage({
      emit,
      message: toolUseMessage,
      modelSelection,
      session: liveSession,
      timestamp,
    });
    handleClaudeSdkMessage({
      emit,
      message: replacementMessage,
      modelSelection,
      session: liveSession,
      timestamp: resultTimestamp,
    });
    const eventCountBeforeLateResult = liveEvents.length;
    handleClaudeSdkMessage({
      emit,
      message: lateToolResult,
      modelSelection,
      session: liveSession,
      timestamp: resultTimestamp,
    });

    expect(liveEvents.slice(eventCountBeforeLateResult)).toEqual([]);
    const hydrated = toClaudeHistoryMessages(
      claudeHistoryMessageFixtures([toolUseMessage, replacementMessage, lateToolResult]),
      () => resultTimestamp,
    );
    expect(hydrated.map((message) => message.messageId)).toEqual([
      "dadc8578-068b-4907-8c19-a14791e1cfb9",
    ]);
  });

  test("preserves the final response and model without using the SDK query duration", () => {
    const assistantMessage = claudeSdkMessageFixture({
      type: "assistant",
      uuid: "fdb2ba12-c9c6-4ba4-8111-f2f6b32c4d68",
      session_id: "session-1",
      timestamp,
      message: {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "Final answer" }],
        stop_reason: "end_turn",
      },
      parent_tool_use_id: null,
    });
    const resultMessage = claudeSdkMessageFixture({
      type: "result",
      subtype: "success",
      uuid: "06434a62-9c81-489a-8105-a9280611d43d",
      session_id: "session-1",
      timestamp: resultTimestamp,
      is_error: false,
      duration_ms: 2_000,
      result: "Final answer",
      stop_reason: "end_turn",
      terminal_reason: "completed",
      usage: { input_tokens: 1, output_tokens: 2 },
    });
    const liveEvents: AgentEvent[] = [];
    const liveSession = createEventTestSession();
    liveSession.acceptedUserMessages.push({});
    liveSession.pendingUserTurnCount = 1;
    const emit = (event: AgentEvent) => liveEvents.push(event);
    const modelSelection = (model: string) => ({
      providerId: "claude",
      modelId: model,
      runtimeKind: "claude" as const,
    });

    handleClaudeSdkMessage({
      emit,
      message: assistantMessage,
      modelSelection,
      session: liveSession,
      timestamp,
    });
    handleClaudeSdkMessage({
      emit,
      message: resultMessage,
      modelSelection,
      session: liveSession,
      timestamp: resultTimestamp,
    });
    const liveFinal = liveEvents.find(
      (event): event is Extract<AgentEvent, { type: "assistant_message" }> =>
        event.type === "assistant_message" && event.message === "Final answer",
    );
    const hydratedFinal = toClaudeHistoryMessages(
      claudeHistoryMessageFixtures([assistantMessage, resultMessage]),
      () => resultTimestamp,
    ).find((message) => message.role === "assistant");

    expect(liveFinal).toMatchObject({
      message: hydratedFinal?.text,
      model: hydratedFinal?.model,
    });
    expect(liveFinal).not.toHaveProperty("durationMs");
    expect(hydratedFinal).not.toHaveProperty("durationMs");
  });

  test("projects completed subagents with their initial description in both paths", () => {
    const assistantMessage = claudeSdkMessageFixture({
      type: "assistant",
      uuid: "1cc065b2-d4e2-40ee-83a8-72c54810b703",
      session_id: "session-1",
      timestamp,
      message: {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [
          {
            type: "tool_use",
            id: "tool-agent-1",
            name: "Agent",
            input: {
              description: "Inspect authentication",
              subagent_type: "Explore",
              prompt: "Inspect the authentication flow",
            },
          },
        ],
        stop_reason: "tool_use",
      },
      parent_tool_use_id: null,
    });
    const resultMessage = claudeSdkMessageFixture({
      type: "user",
      uuid: "c3a28741-103b-4201-8b2b-5f736826816c",
      session_id: "session-1",
      parent_tool_use_id: null,
      timestamp: resultTimestamp,
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-agent-1",
            content: [{ type: "text", text: "Final authentication summary" }],
          },
        ],
      },
      tool_use_result: {
        status: "completed",
        prompt: "Inspect the authentication flow",
        agentId: "agent-session-1",
        agentType: "Explore",
        content: [{ type: "text", text: "Final authentication summary" }],
        totalDurationMs: 1_200,
        totalTokens: 42,
      },
    });
    const liveEvents: AgentEvent[] = [];
    const liveSession = createEventTestSession();
    const emit = (event: AgentEvent) => liveEvents.push(event);
    const modelSelection = (model: string) => ({
      providerId: "claude",
      modelId: model,
      runtimeKind: "claude" as const,
    });

    handleClaudeSdkMessage({
      emit,
      message: assistantMessage,
      modelSelection,
      session: liveSession,
      timestamp,
    });
    handleClaudeSdkMessage({
      emit,
      message: resultMessage,
      modelSelection,
      session: liveSession,
      timestamp: resultTimestamp,
    });
    const liveSubagent = assistantParts(liveEvents).find(
      (part) => part.kind === "subagent" && part.status === "completed",
    );
    const hydratedSubagent = toClaudeHistoryMessages(
      [claudeSessionMessageFixture(assistantMessage), claudeSessionMessageFixture(resultMessage)],
      () => resultTimestamp,
    )
      .flatMap((message) => message.parts)
      .find((part) => part.kind === "subagent" && part.status === "completed");

    expect(liveSubagent).toEqual(hydratedSubagent);
    expect(liveSubagent).toMatchObject({
      description: "Inspect authentication",
      executionMode: "foreground",
      prompt: "Inspect the authentication flow",
    });
  });
});
