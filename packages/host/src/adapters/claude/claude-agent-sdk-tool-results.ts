import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "@openducktor/core";
import { emitClaudeAgentToolResultSubagentPart } from "./claude-agent-sdk-subagents";
import { decodeClaudeToolResultValue, timestampMs } from "./claude-agent-sdk-tool-shapes";
import { isClaudeToolUseRetracted } from "./claude-agent-sdk-transcript-correlation";
import { createClaudeCompletedToolPart } from "./claude-agent-sdk-transcript-parts";
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
  toolStartedAtMsByCallId: Map<string, number>;
};

type ClaudeDecodedToolResult = NonNullable<ReturnType<typeof decodeClaudeToolResultValue>>;

const mergeTopLevelToolUseResult = (
  result: ClaudeDecodedToolResult,
  message: Extract<SDKMessage, { type: "user" }>,
): ClaudeDecodedToolResult => {
  const rawMessage = message as unknown as Record<string, unknown>;
  const toolUseResult = rawMessage.toolUseResult;
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

  const rawMessage = message as unknown as Record<string, unknown>;
  return decodeClaudeToolResultValue(rawMessage.toolUseResult, message.parent_tool_use_id, {
    allowNonToolResultType: true,
  });
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
  const part = createClaudeCompletedToolPart({
    callId: result.toolUseId,
    endedAtMs: timestampMs(timestamp),
    isError: result.isError,
    messageId,
    raw: result.raw,
    text: result.text,
    tool,
    ...(input ? { input } : {}),
    ...(typeof startedAtMs === "number" ? { startedAtMs } : {}),
  });
  emit({
    type: "assistant_part",
    externalSessionId: session.externalSessionId,
    timestamp,
    part,
  });
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
