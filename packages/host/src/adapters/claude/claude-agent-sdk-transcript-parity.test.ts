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
  claudeSessionMessageFixture,
} from "./claude-agent-sdk-test-messages";
import { handleClaudeUserToolResultMessage } from "./claude-agent-sdk-tool-results";

const timestamp = "2026-06-25T20:00:00.000Z";
const resultTimestamp = "2026-06-25T20:00:02.000Z";

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
        uuid: "subagent-prompt",
        session_id: "session-1",
        parent_tool_use_id: "agent-tool",
        message: { role: "user", content: "Inspect the authentication flow." },
      }),
      claudeSdkMessageFixture({
        type: "user",
        uuid: "subagent-skill-context",
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

  test("keeps the streamed response identity when the SDK assistant snapshot precedes message stop", () => {
    const responseId = "response-final";
    const assistantUuid = "assistant-final";
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
        uuid: "assistant-stream-start",
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
        uuid: "assistant-stream-delta",
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
        uuid: "result-final",
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

  test("keeps one response identity for streamed subagent finals without a stop reason", () => {
    const responseId = "subagent-response-final";
    const assistantUuid = "subagent-assistant-final";
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
        type: "stream_event",
        uuid: "subagent-stream-start",
        session_id: "session-1",
        parent_tool_use_id: parentToolUseId,
        event: {
          type: "message_start",
          message: { id: responseId },
        },
      }),
      claudeSdkMessageFixture({
        type: "stream_event",
        uuid: "subagent-stream-delta",
        session_id: "session-1",
        parent_tool_use_id: parentToolUseId,
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: finalText },
        },
      }),
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
    ).toEqual([responseId, responseId]);
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
      uuid: "assistant-first",
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
      uuid: "assistant-final",
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
      uuid: "assistant-reasoning",
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
      uuid: "assistant-final",
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
        uuid: "assistant-stream-start",
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
        uuid: "assistant-thinking-stream",
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
        uuid: "assistant-thinking-stop",
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
        uuid: "assistant-stream",
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
      uuid: "assistant-final",
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
        uuid: "assistant-stream",
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
    expect(hydratedIds).toEqual(["assistant-final"]);
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
    ];
    const sdkMessage = claudeSdkMessageFixture({
      type: "assistant",
      uuid: "assistant-1",
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
      const input =
        testCase.tool === "Read" ? { file_path: "/repo/file.ts" } : { command: "exit 1" };
      const assistantMessage = claudeSdkMessageFixture({
        type: "assistant",
        uuid: `assistant-${index}`,
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
        uuid: `result-${index}`,
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
      liveSession.toolMessageIdsByCallId.set(toolUseId, `assistant-${index}`);
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
      uuid: "assistant-parallel-tools",
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
      uuid: "result-parallel-tools",
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
      liveSession.toolMessageIdsByCallId.set(toolUse.id, "assistant-parallel-tools");
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

  test("preserves file-reference display parts across live send and hydrated history", async () => {
    const parts: AgentUserMessagePart[] = [
      { kind: "text", text: "Inspect " },
      {
        kind: "file_reference",
        file: {
          id: "docs/My File.md",
          path: "docs/My File.md",
          name: "My File.md",
          kind: "code",
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
      randomId: () => "user-structured-1",
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
      uuid: "assistant-refused",
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
      uuid: "assistant-canonical",
      session_id: "session-1",
      parent_tool_use_id: null,
      supersedes: ["assistant-refused"],
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
    expect(hydratedIds).toEqual(["assistant-canonical"]);
  });

  test("does not resurrect retracted subagents when late task events arrive", () => {
    const toolUseMessage = claudeSdkMessageFixture({
      type: "assistant",
      uuid: "assistant-retracted-agent",
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
      uuid: "task-started-retracted",
      session_id: "session-1",
      task_id: "task-retracted",
      tool_use_id: "tool-agent-retracted",
      description: "Inspect auth",
      prompt: "Inspect the authentication flow",
      subagent_type: "Explore",
    });
    const replacementMessage = claudeSdkMessageFixture({
      type: "assistant",
      uuid: "assistant-replacement",
      session_id: "session-1",
      parent_tool_use_id: null,
      supersedes: ["assistant-retracted-agent"],
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Continuing without that subagent." }],
        stop_reason: "end_turn",
      },
    });
    const lateTaskNotification = claudeSdkMessageFixture({
      type: "system",
      subtype: "task_notification",
      uuid: "task-notification-late",
      session_id: "session-1",
      task_id: "task-retracted",
      status: "completed",
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
    expect(hydrated.map((message) => message.messageId)).toEqual(["assistant-replacement"]);
  });

  test("does not resurrect retracted tools when late results arrive", () => {
    const toolUseMessage = claudeSdkMessageFixture({
      type: "assistant",
      uuid: "assistant-retracted-tool",
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
      uuid: "assistant-tool-replacement",
      session_id: "session-1",
      parent_tool_use_id: null,
      supersedes: ["assistant-retracted-tool"],
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Continuing without that read." }],
        stop_reason: "end_turn",
      },
    });
    const lateToolResult = claudeSdkMessageFixture({
      type: "user",
      uuid: "tool-result-late",
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
    expect(hydrated.map((message) => message.messageId)).toEqual(["assistant-tool-replacement"]);
  });

  test("preserves final response duration and model across live and hydrated projections", () => {
    const assistantMessage = claudeSdkMessageFixture({
      type: "assistant",
      uuid: "assistant-final",
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
      uuid: "result-1",
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
        event.type === "assistant_message" && event.durationMs === 2_000,
    );
    const hydratedFinal = toClaudeHistoryMessages(
      claudeHistoryMessageFixtures([assistantMessage, resultMessage]),
      () => resultTimestamp,
    ).find((message) => message.role === "assistant");

    expect(liveFinal).toMatchObject({
      message: hydratedFinal?.text,
      durationMs: hydratedFinal?.durationMs,
      model: hydratedFinal?.model,
    });
  });

  test("projects completed subagents with their initial description in both paths", () => {
    const assistantMessage = claudeSdkMessageFixture({
      type: "assistant",
      uuid: "assistant-agent",
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
      uuid: "result-agent",
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
