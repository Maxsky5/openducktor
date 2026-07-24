import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "@openducktor/core";
import { projectClaudeCompletedToolResult } from "./claude-agent-sdk-completed-tool-result";
import { emitClaudeAgentToolResultSubagentPart } from "./claude-agent-sdk-subagents";
import type { ClaudeTodoState } from "./claude-agent-sdk-todos";
import { decodeClaudeToolResultValue, timestampMs } from "./claude-agent-sdk-tool-shapes";
import { isClaudeToolUseRetracted } from "./claude-agent-sdk-transcript-correlation";
import { isRecord } from "./claude-agent-sdk-utils";

type ClaudeToolResultSession = {
  externalSessionId: string;
  retractedSubagentTaskIds?: Set<string>;
  retractedToolUseIds?: Set<string>;
  subagentMessageIdsByTaskId: Map<string, string>;
  subagentTaskIdsByToolUseId: Map<string, string>;
  toolInputsByCallId: Map<string, Record<string, unknown>>;
  toolMessageIdsByCallId: Map<string, string>;
  toolNamesByCallId: Map<string, string>;
  toolEndedAtMsByCallId?: Map<string, number>;
  toolStartedAtMsByCallId: Map<string, number>;
  todosById: ClaudeTodoState;
};

type ClaudeDecodedToolResult = NonNullable<ReturnType<typeof decodeClaudeToolResultValue>>;

const mergeTopLevelToolUseResult = (
  result: ClaudeDecodedToolResult,
  message: Extract<SDKMessage, { type: "user" }>,
): ClaudeDecodedToolResult => {
  const rawMessage = message as unknown as Record<string, unknown>;
  const toolUseResult = rawMessage.tool_use_result;
  if (!isRecord(toolUseResult)) {
    return result;
  }
  return {
    ...result,
    raw: {
      ...result.raw,
      structuredContent: toolUseResult,
      toolUseResult,
    },
  };
};

const readToolUseResult = (message: Extract<SDKMessage, { type: "user" }>) => {
  const direct = decodeClaudeToolResultValue(message.tool_use_result, message.parent_tool_use_id, {
    allowNonToolResultType: true,
  });
  if (direct) {
    return mergeTopLevelToolUseResult(direct, message);
  }

  const content = (message.message as { content?: unknown }).content;
  if (Array.isArray(content)) {
    for (const block of content) {
      const result = decodeClaudeToolResultValue(block, message.parent_tool_use_id);
      if (result) {
        return mergeTopLevelToolUseResult(result, message);
      }
    }
  }
  return null;
};

export const handleClaudeUserToolResultMessage = ({
  emit,
  message,
  session,
  timestamp,
}: {
  emit: (event: AgentEvent) => void;
  message: Extract<SDKMessage, { type: "user" }>;
  session: ClaudeToolResultSession;
  timestamp: string;
}): void => {
  const result = readToolUseResult(message);
  if (!result) {
    return;
  }
  if (isClaudeToolUseRetracted(session, result.toolUseId)) {
    return;
  }
  const tool = session.toolNamesByCallId.get(result.toolUseId) ?? result.toolName;
  if (!tool) {
    return;
  }
  const input = session.toolInputsByCallId.get(result.toolUseId);
  const messageId =
    session.toolMessageIdsByCallId.get(result.toolUseId) ?? message.uuid ?? result.toolUseId;
  const startedAtMs = session.toolStartedAtMsByCallId.get(result.toolUseId);
  const endedAtMs = session.toolEndedAtMsByCallId?.get(result.toolUseId) ?? timestampMs(timestamp);
  const { part, todos } = projectClaudeCompletedToolResult({
    callId: result.toolUseId,
    endedAtMs,
    ...(input ? { input } : {}),
    isError: result.isError,
    messageId,
    raw: result.raw,
    resultText: result.text,
    ...(typeof startedAtMs === "number" ? { startedAtMs } : {}),
    state: session.todosById,
    tool,
  });
  emit({
    type: "assistant_part",
    externalSessionId: session.externalSessionId,
    timestamp,
    part,
  });
  if (todos) {
    emit({
      type: "session_todos_updated",
      externalSessionId: session.externalSessionId,
      timestamp,
      todos,
    });
  }
  if (tool === "Agent") {
    emitClaudeAgentToolResultSubagentPart({
      emit,
      isError: result.isError,
      resultRaw: result.raw,
      resultText: result.text,
      session,
      timestamp,
      toolUseId: result.toolUseId,
      ...(input ? { input } : {}),
    });
  }
};
