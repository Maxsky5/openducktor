import type {
  AgentEvent,
  AgentSessionHistoryMessage,
  AgentSkillReference,
  AgentStreamPart,
} from "@openducktor/core";
import { CLAUDE_COMPACTED_MESSAGE } from "./claude-agent-sdk-compaction";
import { projectClaudeCompletedToolResult } from "./claude-agent-sdk-completed-tool-result";
import {
  addClaudeHistoryFinishStep,
  isLiveFinalAssistantStopReason,
  type MutableAssistantHistoryMessage,
  projectClaudeHistoryAssistantMessage,
} from "./claude-agent-sdk-history-assistant";
import {
  isNestedHistoryEntry,
  readHistorySessionId,
  readHistoryTimestamp,
} from "./claude-agent-sdk-history-entry";
import {
  type ClaudeHistoryMessage,
  type ClaudeHistoryResultMessage,
  isClaudeHistoryCompactBoundaryMessage,
  isClaudeHistorySubagentSystemMessage,
} from "./claude-agent-sdk-history-import";
import { createClaudeHistoryInputProjector } from "./claude-agent-sdk-history-input";
import {
  type ClaudeLiveUserMessage,
  hasFinalStopStep,
  readHistoryToolResults,
  retractedHistoryMessageIds,
} from "./claude-agent-sdk-history-support";
import {
  finishReasonForClaudeResult,
  isFailedClaudeResult,
  readClaudeResultDurationMs,
} from "./claude-agent-sdk-result-lifecycle";
import {
  emitClaudeAgentToolResultSubagentPart,
  handleClaudeSubagentSystemMessage,
} from "./claude-agent-sdk-subagents";
import type { ClaudeTodoState } from "./claude-agent-sdk-todos";
import { timestampMs } from "./claude-agent-sdk-tool-shapes";
import {
  isClaudeToolUseRetracted,
  retractClaudeTranscriptCorrelations,
} from "./claude-agent-sdk-transcript-correlation";
import { isRecord, readStringProp } from "./claude-agent-sdk-utils";

const successfulResultText = (entry: ClaudeHistoryResultMessage): string | null => {
  if (isFailedClaudeResult(entry)) {
    return null;
  }
  const text = typeof entry.result === "string" ? entry.result.trim() : "";
  return text.length > 0 ? text : null;
};
const failedResultText = (entry: ClaudeHistoryResultMessage): string => {
  const errors = Array.isArray(entry.errors)
    ? entry.errors.filter((error): error is string => typeof error === "string")
    : [];
  if (errors.length > 0) {
    return errors.join("\n");
  }
  const result = typeof entry.result === "string" ? entry.result.trim() : "";
  if (result.length > 0) {
    return result;
  }
  const terminalReason = readStringProp(entry, "terminal_reason");
  return `Claude Agent SDK result failed: ${terminalReason ?? String(entry.subtype)}`;
};

export const toClaudeHistoryMessages = (
  messages: ClaudeHistoryMessage[],
  now: () => string,
  liveUserMessages: readonly ClaudeLiveUserMessage[] = [],
  options: {
    includeNestedEntries?: boolean;
    skills?: readonly AgentSkillReference[];
  } = {},
): AgentSessionHistoryMessage[] => {
  const history: AgentSessionHistoryMessage[] = [];
  const assistantMessagesByToolCallId = new Map<string, MutableAssistantHistoryMessage>();
  const toolMessageIdsByCallId = new Map<string, string>();
  const toolNamesByCallId = new Map<string, string>();
  const toolInputsByCallId = new Map<string, Record<string, unknown>>();
  const hiddenSubagentTaskIds = new Set<string>();
  const subagentMessageIdsByTaskId = new Map<string, string>();
  const subagentTaskIdsByToolUseId = new Map<string, string>();
  const retractedSubagentTaskIds = new Set<string>();
  const retractedToolUseIds = new Set<string>();
  const todosById: ClaudeTodoState = new Map();
  const correlationState = {
    hiddenSubagentTaskIds,
    retractedSubagentTaskIds,
    retractedToolUseIds,
    subagentMessageIdsByTaskId,
    subagentTaskIdsByToolUseId,
    toolMessageIdsByCallId,
    toolNamesByCallId,
  };
  const projectHistoryInput = createClaudeHistoryInputProjector({
    liveUserMessages,
    ...(options.skills ? { skills: options.skills } : {}),
  });
  let lastAssistantMessage: MutableAssistantHistoryMessage | null = null;
  let lastAssistantTextMessage: MutableAssistantHistoryMessage | null = null;
  let lastAssistantText: string | undefined;
  let lastFinalAssistantMessage: MutableAssistantHistoryMessage | null = null;
  let lastFinalAssistantText: string | undefined;
  let pendingManualCompaction: { messageId: string; timestamp: string } | null = null;
  let manualCompactionBoundaryReceived = false;
  let unclaimedManualCompactionBoundary = false;
  const resetCurrentUserTurnAssistantTracking = () => {
    lastAssistantMessage = null;
    lastAssistantTextMessage = null;
    lastAssistantText = undefined;
    lastFinalAssistantMessage = null;
    lastFinalAssistantText = undefined;
  };
  const rebuildLastAssistantTracking = () => {
    resetCurrentUserTurnAssistantTracking();
    for (const message of history) {
      if (message.role !== "assistant") {
        continue;
      }
      lastAssistantMessage = message;
      if (message.text.trim().length > 0) {
        lastAssistantTextMessage = message;
        lastAssistantText = message.text;
      }
      if (message.text.trim().length > 0 && hasFinalStopStep(message)) {
        lastFinalAssistantMessage = message;
        lastFinalAssistantText = message.text;
      }
    }
  };
  const removeRetractedMessages = (messageIds: string[]) => {
    const retractedIds = new Set(messageIds);
    const retractedCorrelations = retractClaudeTranscriptCorrelations(correlationState, messageIds);
    for (const toolUseId of retractedCorrelations.toolUseIds) {
      assistantMessagesByToolCallId.delete(toolUseId);
    }
    let removed = false;
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const message = history[index];
      if (!message || !retractedIds.has(message.messageId)) {
        continue;
      }
      history.splice(index, 1);
      removed = true;
    }
    if (removed) {
      rebuildLastAssistantTracking();
    }
  };
  for (let entryIndex = 0; entryIndex < messages.length; entryIndex += 1) {
    const entry = messages[entryIndex];
    if (!entry) {
      continue;
    }
    removeRetractedMessages(retractedHistoryMessageIds(entry));
    if (!options.includeNestedEntries && isNestedHistoryEntry(entry)) {
      continue;
    }
    const timestamp = readHistoryTimestamp(entry, now);
    const projectedInput = projectHistoryInput(entry, timestamp);
    if (projectedInput.handled) {
      if (projectedInput.manualCompaction) {
        pendingManualCompaction = projectedInput.manualCompaction;
        manualCompactionBoundaryReceived = unclaimedManualCompactionBoundary;
        unclaimedManualCompactionBoundary = false;
        resetCurrentUserTurnAssistantTracking();
        continue;
      }
      const projectedMessage = projectedInput.message;
      if (!projectedMessage) {
        continue;
      }
      history.push(projectedMessage);
      if (projectedMessage.role === "user") {
        resetCurrentUserTurnAssistantTracking();
        continue;
      }
      lastAssistantMessage = projectedMessage;
      lastAssistantTextMessage = projectedMessage;
      lastAssistantText = projectedMessage.text;
      lastFinalAssistantMessage = projectedMessage;
      lastFinalAssistantText = projectedMessage.text;
      continue;
    }
    if (isClaudeHistoryCompactBoundaryMessage(entry)) {
      history.push({
        messageId: pendingManualCompaction?.messageId ?? entry.uuid,
        role: "system",
        timestamp,
        text: CLAUDE_COMPACTED_MESSAGE,
        notice: {
          tone: "info",
          reason: "session_compacted",
          title: "Compacted",
        },
        parts: [],
      });
      if (pendingManualCompaction) {
        manualCompactionBoundaryReceived = true;
      } else if (
        isRecord(entry.compact_metadata) &&
        readStringProp(entry.compact_metadata, "trigger") === "manual"
      ) {
        unclaimedManualCompactionBoundary = true;
      }
      continue;
    }
    if (isClaudeHistorySubagentSystemMessage(entry)) {
      const events: AgentEvent[] = [];
      handleClaudeSubagentSystemMessage({
        emit: (event) => events.push(event),
        message: entry as Parameters<typeof handleClaudeSubagentSystemMessage>[0]["message"],
        session: {
          externalSessionId: readHistorySessionId(entry),
          hiddenSubagentTaskIds,
          subagentMessageIdsByTaskId,
          subagentTaskIdsByToolUseId,
          toolMessageIdsByCallId,
          toolNamesByCallId,
          retractedSubagentTaskIds,
          retractedToolUseIds,
        },
        timestamp,
      });
      for (const event of events) {
        if (event.type !== "assistant_part" || event.part.kind !== "subagent") {
          continue;
        }
        history.push({
          messageId: event.part.messageId,
          role: "assistant",
          timestamp,
          text: "",
          parts: [event.part],
        });
      }
      continue;
    }
    if (entry.type === "user") {
      const toolResults = readHistoryToolResults(entry);
      if (toolResults.length > 0) {
        for (const toolResult of toolResults) {
          if (isClaudeToolUseRetracted(correlationState, toolResult.toolUseId)) {
            continue;
          }
          const existingMessage = assistantMessagesByToolCallId.get(toolResult.toolUseId);
          const existingPart = existingMessage?.parts.find(
            (part) => part.kind === "tool" && part.callId === toolResult.toolUseId,
          ) as Extract<AgentStreamPart, { kind: "tool" }> | undefined;
          const tool =
            toolNamesByCallId.get(toolResult.toolUseId) ??
            existingPart?.tool ??
            toolResult.toolName;
          if (!tool) {
            continue;
          }
          const toolInput = toolInputsByCallId.get(toolResult.toolUseId);
          const { part: completedPart } = projectClaudeCompletedToolResult({
            callId: toolResult.toolUseId,
            endedAtMs: timestampMs(timestamp),
            ...(toolInput ? { input: toolInput } : {}),
            isError: toolResult.isError,
            messageId: existingMessage?.messageId ?? entry.uuid ?? toolResult.toolUseId,
            ...(existingPart?.metadata ? { metadata: existingPart.metadata } : {}),
            ...(existingPart?.preview ? { preview: existingPart.preview } : {}),
            raw: toolResult.raw,
            resultText: toolResult.text,
            state: todosById,
            tool,
          });
          const subagentParts: AgentStreamPart[] = [];
          if (tool === "Agent") {
            const subagentEvents: AgentEvent[] = [];
            emitClaudeAgentToolResultSubagentPart({
              emit: (event) => subagentEvents.push(event),
              isError: toolResult.isError,
              resultRaw: toolResult.raw,
              resultText: toolResult.text,
              session: {
                externalSessionId: readHistorySessionId(entry),
                subagentMessageIdsByTaskId,
                subagentTaskIdsByToolUseId,
                toolMessageIdsByCallId,
                toolNamesByCallId,
                retractedSubagentTaskIds,
                retractedToolUseIds,
              },
              timestamp,
              toolUseId: toolResult.toolUseId,
              ...(toolInput ? { input: toolInput } : {}),
            });
            for (const event of subagentEvents) {
              if (event.type !== "assistant_part" || event.part.kind !== "subagent") {
                continue;
              }
              subagentParts.push({
                ...event.part,
                messageId: completedPart.messageId,
              });
            }
          }
          if (existingMessage) {
            const incomingSubagentSessionIds = new Set(
              subagentParts.flatMap((part) =>
                part.kind === "subagent" && part.externalSessionId ? [part.externalSessionId] : [],
              ),
            );
            existingMessage.parts = [
              ...existingMessage.parts
                .map((part) =>
                  part.kind === "tool" && part.callId === toolResult.toolUseId
                    ? completedPart
                    : part,
                )
                .filter(
                  (part) =>
                    part.kind !== "subagent" ||
                    !part.externalSessionId ||
                    !incomingSubagentSessionIds.has(part.externalSessionId),
                ),
              ...subagentParts,
            ];
          } else {
            history.push({
              messageId: entry.uuid ?? toolResult.toolUseId,
              role: "assistant",
              timestamp,
              text: "",
              parts: [completedPart, ...subagentParts],
            });
          }
        }
        continue;
      }
      continue;
    }
    if (entry.type === "assistant") {
      const projection = projectClaudeHistoryAssistantMessage({
        entry,
        entryIndex,
        messages,
        options,
        timestamp,
        toolInputsByCallId,
        toolMessageIdsByCallId,
        toolNamesByCallId,
      });
      if (!projection) {
        continue;
      }
      const { message: assistantMessage, stopReason } = projection;
      history.push(assistantMessage);
      lastAssistantMessage = assistantMessage;
      if (assistantMessage.text.trim().length > 0) {
        lastAssistantTextMessage = assistantMessage;
        lastAssistantText = assistantMessage.text;
        if (isLiveFinalAssistantStopReason(stopReason)) {
          lastFinalAssistantMessage = assistantMessage;
          lastFinalAssistantText = assistantMessage.text;
        }
      }
      for (const part of assistantMessage.parts) {
        if (part.kind === "tool") {
          assistantMessagesByToolCallId.set(part.callId, assistantMessage);
        }
      }
      continue;
    }
    if (entry.type === "result") {
      if (pendingManualCompaction) {
        if (isFailedClaudeResult(entry)) {
          history.push({
            messageId: entry.uuid ?? pendingManualCompaction.messageId,
            role: "system",
            timestamp,
            text: failedResultText(entry),
            parts: [],
          });
        } else if (!manualCompactionBoundaryReceived) {
          history.push({
            messageId: pendingManualCompaction.messageId,
            role: "system",
            timestamp,
            text: successfulResultText(entry) ?? "No session compaction was needed.",
            notice: {
              tone: "info",
              reason: "session_compacted",
              title: "Compacted",
            },
            parts: [],
          });
        }
        pendingManualCompaction = null;
        manualCompactionBoundaryReceived = false;
        continue;
      }
      const resultText = successfulResultText(entry);
      const durationMs = readClaudeResultDurationMs(entry);
      const lastMatchingAssistantTextMessage =
        resultText && resultText === lastAssistantText ? lastAssistantTextMessage : null;
      const resultTarget: MutableAssistantHistoryMessage | null =
        resultText && resultText === lastFinalAssistantText
          ? lastFinalAssistantMessage
          : (lastMatchingAssistantTextMessage ?? lastAssistantMessage);
      if (
        resultText &&
        resultText !== lastFinalAssistantText &&
        !lastMatchingAssistantTextMessage
      ) {
        const assistantMessage: MutableAssistantHistoryMessage = {
          messageId: entry.uuid ?? `claude-result:${history.length}`,
          role: "assistant",
          timestamp,
          text: resultText,
          parts: [],
          ...(durationMs !== undefined ? { durationMs } : {}),
        };
        addClaudeHistoryFinishStep(assistantMessage, finishReasonForClaudeResult(entry));
        history.push(assistantMessage);
        lastAssistantMessage = assistantMessage;
        lastAssistantTextMessage = assistantMessage;
        lastAssistantText = resultText;
        lastFinalAssistantMessage = assistantMessage;
        lastFinalAssistantText = resultText;
        continue;
      }
      if (!resultTarget) {
        continue;
      }
      if (durationMs !== undefined) {
        resultTarget.durationMs = durationMs;
      }
      addClaudeHistoryFinishStep(resultTarget, finishReasonForClaudeResult(entry));
      if (resultText) {
        lastFinalAssistantMessage = resultTarget;
        lastFinalAssistantText = resultText;
      }
    }
  }
  return history;
};
