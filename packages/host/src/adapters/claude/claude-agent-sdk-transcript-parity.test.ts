import { describe, expect, test } from "bun:test";
import type { SDKMessage, SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "@openducktor/core";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession } from "./claude-agent-sdk-events.test-support";
import { toClaudeHistoryMessages } from "./claude-agent-sdk-history";
import { handleClaudeUserToolResultMessage } from "./claude-agent-sdk-tool-results";

const timestamp = "2026-06-25T20:00:00.000Z";
const resultTimestamp = "2026-06-25T20:00:02.000Z";

const assistantParts = (events: AgentEvent[]) =>
  events.flatMap((event) => (event.type === "assistant_part" ? [event.part] : []));

describe("Claude live and hydrated transcript parity", () => {
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
    ];
    const sdkMessage = {
      type: "assistant",
      uuid: "assistant-1",
      session_id: "session-1",
      timestamp,
      message: {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content,
        stop_reason: "tool_use",
      },
    } as unknown as SDKMessage;
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
      [sdkMessage as unknown as SessionMessage],
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
      const assistantMessage = {
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
      } as unknown as SessionMessage;
      const resultMessage = {
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
      } as unknown as SessionMessage;
      const history = toClaudeHistoryMessages(
        [assistantMessage, resultMessage],
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
      liveSession.toolStartedAtMsByCallId.set(toolUseId, Date.parse(timestamp));

      handleClaudeUserToolResultMessage({
        emit: (event) => liveEvents.push(event),
        message: resultMessage as unknown as Extract<SDKMessage, { type: "user" }>,
        session: liveSession,
        timestamp: resultTimestamp,
      });

      expect(assistantParts(liveEvents)[0]).toEqual(historyPart);
    }
  });

  test("preserves final response duration and model across live and hydrated projections", () => {
    const assistantMessage = {
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
    } as unknown as SDKMessage;
    const resultMessage = {
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
    } as unknown as SDKMessage;
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
      [assistantMessage, resultMessage] as unknown as SessionMessage[],
      () => resultTimestamp,
    ).find((message) => message.role === "assistant");

    expect(liveFinal).toMatchObject({
      message: hydratedFinal?.text,
      durationMs: hydratedFinal?.durationMs,
      model: hydratedFinal?.model,
    });
  });

  test("projects completed subagents with their initial description in both paths", () => {
    const assistantMessage = {
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
    } as unknown as SDKMessage;
    const resultMessage = {
      type: "user",
      uuid: "result-agent",
      session_id: "session-1",
      parent_tool_use_id: "tool-agent-1",
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
      toolUseResult: {
        status: "completed",
        prompt: "Inspect the authentication flow",
        agentId: "agent-session-1",
        agentType: "Explore",
        content: [{ type: "text", text: "Final authentication summary" }],
        totalDurationMs: 1_200,
        totalTokens: 42,
      },
    } as unknown as SDKMessage;
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
      [assistantMessage, resultMessage] as unknown as SessionMessage[],
      () => resultTimestamp,
    )
      .flatMap((message) => message.parts)
      .find((part) => part.kind === "subagent" && part.status === "completed");

    expect(liveSubagent).toEqual(hydratedSubagent);
    expect(liveSubagent).toMatchObject({
      description: "Inspect authentication",
      prompt: "Inspect the authentication flow",
    });
  });
});
