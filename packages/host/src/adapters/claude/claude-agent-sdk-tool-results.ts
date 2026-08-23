import { hasRuntimeType } from "@openducktor/contracts";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "@openducktor/core";
import { projectClaudeCompletedToolResult } from "./claude-agent-sdk-completed-tool-result";
import {
  emitClaudeAgentToolResultSubagentPart,
  emitClaudeTaskStopSubagentPart,
} from "./claude-agent-sdk-subagents";
import {
  type ClaudeTodoProjection,
  type ClaudeTodoState,
  rememberClaudeTodoToolResult,
} from "./claude-agent-sdk-todos";
import {
  type ClaudeToolResultIngress,
  type ClaudeUserToolResultIngress,
  parseClaudeUserToolResultIngress,
} from "./claude-agent-sdk-ingress-schemas";
import { decodeClaudeToolResultValue, timestampMs } from "./claude-agent-sdk-tool-shapes";
import { isClaudeToolUseRetracted } from "./claude-agent-sdk-transcript-correlation";
import { HostValidationError } from "../../effect/host-errors";

type ClaudeToolResultSession = {
  activeBackgroundSubagentTaskIds?: Set<string>;
  externalSessionId: string;
  retractedSubagentTaskIds?: Set<string>;
  retractedToolUseIds?: Set<string>;
  subagentAgentIdsByToolUseId?: Map<string, string>;
  subagentMessageIdsByTaskId: Map<string, string>;
  subagentTaskIdsByToolUseId: Map<string, string>;
  toolInputsByCallId: Map<string, Record<string, unknown>>;
  toolMessageIdsByCallId: Map<string, string>;
  toolNamesByCallId: Map<string, string>;
  toolEndedAtMsByCallId?: Map<string, number>;
  toolStartedAtMsByCallId: Map<string, number>;
  todoProjection?: ClaudeTodoProjection;
  todosById: ClaudeTodoState;
};

type ClaudeDecodedToolResult = NonNullable<ReturnType<typeof decodeClaudeToolResultValue>>;

const mergeTopLevelToolUseResult = (
  result: ClaudeDecodedToolResult,
  toolUseResult: ClaudeToolResultIngress["structuredOutput"],
): ClaudeDecodedToolResult => {
  if (!toolUseResult) {
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

const readToolUseResults = (message: ClaudeUserToolResultIngress): ClaudeDecodedToolResult[] => {
  return message.toolResults.map(({ raw, structuredOutput }) => {
    const result = decodeClaudeToolResultValue(raw, null);
    if (!result) {
      throw new HostValidationError({
        field: "claudeToolResult",
        message: "Claude SDK sent a tool result that could not be decoded.",
      });
    }
    return mergeTopLevelToolUseResult(result, structuredOutput);
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
  const toolResultMessage = parseClaudeUserToolResultIngress(message);
  for (const result of readToolUseResults(toolResultMessage)) {
    if (isClaudeToolUseRetracted(session, result.toolUseId)) {
      continue;
    }
    const tool = session.toolNamesByCallId.get(result.toolUseId) ?? result.toolName;
    if (!tool) {
      continue;
    }
    const input = session.toolInputsByCallId.get(result.toolUseId);
    const messageId =
      session.toolMessageIdsByCallId.get(result.toolUseId) ?? message.uuid ?? result.toolUseId;
    const startedAtMs = session.toolStartedAtMsByCallId.get(result.toolUseId);
    const endedAtMs =
      session.toolEndedAtMsByCallId?.get(result.toolUseId) ?? timestampMs(timestamp);
    rememberClaudeTodoToolResult({
      callId: result.toolUseId,
      input,
      isError: result.isError,
      raw: result.raw,
      state: session,
      tool,
    });
    const { part, todos } = projectClaudeCompletedToolResult({
      callId: result.toolUseId,
      endedAtMs,
      ...(input ? { input } : undefined),
      isError: result.isError,
      messageId,
      raw: result.raw,
      resultText: result.text,
      ...(hasRuntimeType(startedAtMs, "number") ? { startedAtMs } : undefined),
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
        ...(input ? { input } : undefined),
      });
    } else if (tool === "TaskStop") {
      emitClaudeTaskStopSubagentPart({
        emit,
        resultRaw: result.raw,
        resultText: result.text,
        session,
        timestamp,
      });
    }
    session.toolInputsByCallId.delete(result.toolUseId);
    session.toolStartedAtMsByCallId.delete(result.toolUseId);
    session.toolEndedAtMsByCallId?.delete(result.toolUseId);
  }
};
