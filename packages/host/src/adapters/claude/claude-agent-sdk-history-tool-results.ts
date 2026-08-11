import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent, AgentSessionHistoryMessage, AgentStreamPart } from "@openducktor/core";
import { projectClaudeCompletedToolResult } from "./claude-agent-sdk-completed-tool-result";
import type { MutableAssistantHistoryMessage } from "./claude-agent-sdk-history-assistant";
import { readHistorySessionId } from "./claude-agent-sdk-history-entry";
import type { ClaudeHistoryMessage } from "./claude-agent-sdk-history-import";
import { readHistoryToolResults } from "./claude-agent-sdk-history-support";
import {
  emitClaudeAgentToolResultSubagentPart,
  emitClaudeTaskStopSubagentPart,
  handleClaudeSubagentSystemMessage,
} from "./claude-agent-sdk-subagents";
import {
  type ClaudeTodoProjectionState,
  type ClaudeTodoState,
  rememberClaudeTodoToolResult,
} from "./claude-agent-sdk-todos";
import { timestampMs } from "./claude-agent-sdk-tool-shapes";
import { isClaudeToolUseRetracted } from "./claude-agent-sdk-transcript-correlation";

type SubagentPart = Extract<AgentStreamPart, { kind: "subagent" }>;

export type ClaudeHistoryToolResultState = {
  activeBackgroundSubagentTaskIds: Set<string>;
  assistantMessagesByToolCallId: Map<string, MutableAssistantHistoryMessage>;
  hiddenSubagentTaskIds: Set<string>;
  history: AgentSessionHistoryMessage[];
  retractedSubagentTaskIds: Set<string>;
  retractedToolUseIds: Set<string>;
  subagentAgentIdsByToolUseId: Map<string, string>;
  subagentMessageIdsByTaskId: Map<string, string>;
  subagentTaskIdsByToolUseId: Map<string, string>;
  todoProjectionState: ClaudeTodoProjectionState;
  todosById: ClaudeTodoState;
  toolInputsByCallId: Map<string, Record<string, unknown>>;
  toolMessageIdsByCallId: Map<string, string>;
  toolNamesByCallId: Map<string, string>;
  transcriptExternalSessionId: string | undefined;
};

const historySessionId = (
  state: ClaudeHistoryToolResultState,
  entry: ClaudeHistoryMessage,
): string => state.transcriptExternalSessionId ?? readHistorySessionId(entry);

const appendOrMergeClaudeHistorySubagentPart = (
  history: AgentSessionHistoryMessage[],
  part: SubagentPart,
  timestamp: string,
): void => {
  for (const existingMessage of history) {
    const existingPart = existingMessage.parts.find(
      (candidate) =>
        candidate.kind === "subagent" &&
        (candidate.partId === part.partId ||
          (part.externalSessionId !== undefined &&
            candidate.externalSessionId === part.externalSessionId)),
    );
    if (existingPart?.kind !== "subagent") {
      continue;
    }
    existingMessage.parts = existingMessage.parts.map((candidate) => {
      if (candidate !== existingPart) {
        return candidate;
      }
      const metadata =
        existingPart.metadata || part.metadata
          ? { ...existingPart.metadata, ...part.metadata }
          : undefined;
      return {
        ...existingPart,
        ...part,
        messageId: existingPart.messageId,
        partId: existingPart.partId,
        correlationKey: existingPart.correlationKey,
        ...(metadata ? { metadata } : {}),
      };
    });
    return;
  }
  const existingMessage = history.find((message) => message.messageId === part.messageId);
  if (existingMessage) {
    existingMessage.parts = [...existingMessage.parts, part];
    return;
  }
  history.push({
    messageId: part.messageId,
    role: "assistant",
    timestamp,
    text: "",
    parts: [part],
  });
};

export const appendClaudeHistorySubagentSystemMessage = ({
  entry,
  message,
  state,
  timestamp,
}: {
  entry: ClaudeHistoryMessage;
  message: Parameters<typeof handleClaudeSubagentSystemMessage>[0]["message"];
  state: ClaudeHistoryToolResultState;
  timestamp: string;
}): void => {
  const events: AgentEvent[] = [];
  handleClaudeSubagentSystemMessage({
    emit: (event) => events.push(event),
    message,
    session: {
      activeBackgroundSubagentTaskIds: state.activeBackgroundSubagentTaskIds,
      externalSessionId: historySessionId(state, entry),
      hiddenSubagentTaskIds: state.hiddenSubagentTaskIds,
      retractedSubagentTaskIds: state.retractedSubagentTaskIds,
      retractedToolUseIds: state.retractedToolUseIds,
      subagentAgentIdsByToolUseId: state.subagentAgentIdsByToolUseId,
      subagentMessageIdsByTaskId: state.subagentMessageIdsByTaskId,
      subagentTaskIdsByToolUseId: state.subagentTaskIdsByToolUseId,
      toolInputsByCallId: state.toolInputsByCallId,
      toolMessageIdsByCallId: state.toolMessageIdsByCallId,
      toolNamesByCallId: state.toolNamesByCallId,
    },
    timestamp,
  });
  for (const event of events) {
    if (event.type === "assistant_part" && event.part.kind === "subagent") {
      appendOrMergeClaudeHistorySubagentPart(state.history, event.part, timestamp);
    }
  }
};

const projectAgentResult = ({
  completedMessageId,
  entry,
  input,
  result,
  state,
  timestamp,
}: {
  completedMessageId: string;
  entry: SessionMessage;
  input: Record<string, unknown> | undefined;
  result: ReturnType<typeof readHistoryToolResults>[number];
  state: ClaudeHistoryToolResultState;
  timestamp: string;
}): AgentStreamPart[] => {
  const events: AgentEvent[] = [];
  emitClaudeAgentToolResultSubagentPart({
    emit: (event) => events.push(event),
    isError: result.isError,
    resultRaw: result.raw,
    resultText: result.text,
    session: {
      externalSessionId: historySessionId(state, entry),
      retractedSubagentTaskIds: state.retractedSubagentTaskIds,
      retractedToolUseIds: state.retractedToolUseIds,
      subagentAgentIdsByToolUseId: state.subagentAgentIdsByToolUseId,
      subagentMessageIdsByTaskId: state.subagentMessageIdsByTaskId,
      subagentTaskIdsByToolUseId: state.subagentTaskIdsByToolUseId,
      toolInputsByCallId: state.toolInputsByCallId,
      toolMessageIdsByCallId: state.toolMessageIdsByCallId,
      toolNamesByCallId: state.toolNamesByCallId,
    },
    timestamp,
    toolUseId: result.toolUseId,
    ...(input ? { input } : {}),
  });
  return events.flatMap((event) =>
    event.type === "assistant_part" && event.part.kind === "subagent"
      ? [{ ...event.part, messageId: completedMessageId }]
      : [],
  );
};

const projectTaskStopResult = ({
  entry,
  result,
  state,
  timestamp,
}: {
  entry: SessionMessage;
  result: ReturnType<typeof readHistoryToolResults>[number];
  state: ClaudeHistoryToolResultState;
  timestamp: string;
}): void => {
  const events: AgentEvent[] = [];
  emitClaudeTaskStopSubagentPart({
    emit: (event) => events.push(event),
    resultRaw: result.raw,
    resultText: result.text,
    session: {
      activeBackgroundSubagentTaskIds: state.activeBackgroundSubagentTaskIds,
      externalSessionId: historySessionId(state, entry),
      retractedSubagentTaskIds: state.retractedSubagentTaskIds,
      retractedToolUseIds: state.retractedToolUseIds,
      subagentAgentIdsByToolUseId: state.subagentAgentIdsByToolUseId,
      subagentMessageIdsByTaskId: state.subagentMessageIdsByTaskId,
      subagentTaskIdsByToolUseId: state.subagentTaskIdsByToolUseId,
      toolInputsByCallId: state.toolInputsByCallId,
      toolMessageIdsByCallId: state.toolMessageIdsByCallId,
      toolNamesByCallId: state.toolNamesByCallId,
    },
    timestamp,
  });
  for (const event of events) {
    if (event.type === "assistant_part" && event.part.kind === "subagent") {
      appendOrMergeClaudeHistorySubagentPart(state.history, event.part, timestamp);
    }
  }
};

export const projectClaudeHistoryToolResults = ({
  entry,
  state,
  timestamp,
}: {
  entry: SessionMessage;
  state: ClaudeHistoryToolResultState;
  timestamp: string;
}): boolean => {
  const toolResults = readHistoryToolResults(entry);
  if (toolResults.length === 0) {
    return false;
  }
  for (const result of toolResults) {
    if (isClaudeToolUseRetracted(state, result.toolUseId)) {
      continue;
    }
    const existingMessage = state.assistantMessagesByToolCallId.get(result.toolUseId);
    const existingPart = existingMessage?.parts.find(
      (part) => part.kind === "tool" && part.callId === result.toolUseId,
    ) as Extract<AgentStreamPart, { kind: "tool" }> | undefined;
    const tool =
      state.toolNamesByCallId.get(result.toolUseId) ?? existingPart?.tool ?? result.toolName;
    if (!tool) {
      continue;
    }
    const input = state.toolInputsByCallId.get(result.toolUseId);
    rememberClaudeTodoToolResult({
      callId: result.toolUseId,
      input,
      isError: result.isError,
      raw: result.raw,
      state: state.todoProjectionState,
      tool,
    });
    const { part: completedPart } = projectClaudeCompletedToolResult({
      callId: result.toolUseId,
      endedAtMs: timestampMs(timestamp),
      ...(input ? { input } : {}),
      isError: result.isError,
      messageId: existingMessage?.messageId ?? entry.uuid ?? result.toolUseId,
      ...(existingPart?.metadata ? { metadata: existingPart.metadata } : {}),
      ...(existingPart?.preview ? { preview: existingPart.preview } : {}),
      raw: result.raw,
      resultText: result.text,
      state: state.todosById,
      tool,
    });
    const subagentParts =
      tool === "Agent"
        ? projectAgentResult({
            completedMessageId: completedPart.messageId,
            entry,
            input,
            result,
            state,
            timestamp,
          })
        : [];
    if (tool === "TaskStop") {
      projectTaskStopResult({ entry, result, state, timestamp });
    }
    if (!existingMessage) {
      state.history.push({
        messageId: entry.uuid ?? result.toolUseId,
        role: "assistant",
        timestamp,
        text: "",
        parts: [completedPart, ...subagentParts],
      });
      continue;
    }
    const incomingSessionIds = new Set(
      subagentParts.flatMap((part) =>
        part.kind === "subagent" && part.externalSessionId ? [part.externalSessionId] : [],
      ),
    );
    const incomingPartIds = new Set(
      subagentParts.flatMap((part) => (part.kind === "subagent" ? [part.partId] : [])),
    );
    existingMessage.parts = [
      ...existingMessage.parts
        .map((part) =>
          part.kind === "tool" && part.callId === result.toolUseId ? completedPart : part,
        )
        .filter(
          (part) =>
            part.kind !== "subagent" ||
            ((!part.externalSessionId || !incomingSessionIds.has(part.externalSessionId)) &&
              !incomingPartIds.has(part.partId)),
        ),
      ...subagentParts,
    ];
  }
  return true;
};
