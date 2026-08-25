import {
  isUnknownRecord,
  type AgentEvent,
  type AgentSessionHistoryMessage,
} from "@openducktor/core";
import { CLAUDE_COMPACTED_MESSAGE } from "./claude-agent-sdk-compaction";
import {
  addClaudeHistoryFinishStep,
  isLiveFinalAssistantStopReason,
  type MutableAssistantHistoryMessage,
  moveNestedResultToEnd,
  projectClaudeHistoryAssistantMessage,
} from "./claude-agent-sdk-history-assistant";
import {
  isNestedHistoryEntry,
  readHistorySessionId,
  readHistoryTimestamp,
} from "./claude-agent-sdk-history-entry";
import {
  type ClaudeHistoryMessage,
  isClaudeHistoryCompactBoundaryMessage,
  isClaudeHistorySubagentSystemMessage,
} from "./claude-agent-sdk-history-import";
import { toClaudeTaskNotificationMessage } from "./claude-agent-sdk-history-notifications";
import { createClaudeHistoryInputProjector } from "./claude-agent-sdk-history-input";
import {
  appendUnmatchedLiveUserMessages,
  type ClaudeLiveUserMessage,
  hasFinalStopStep,
  retractedHistoryMessageIds,
} from "./claude-agent-sdk-history-support";
import {
  appendClaudeHistorySubagentSystemMessage,
  type ClaudeHistoryToolResultState,
  projectClaudeHistoryToolResults,
} from "./claude-agent-sdk-history-tool-results";
import {
  failedClaudeResultText,
  finishReasonForClaudeResult,
  isFailedClaudeResult,
  successfulClaudeResultText,
} from "./claude-agent-sdk-result-lifecycle";
import { readClaudeTaskNotifications } from "./claude-agent-sdk-runtime-messages";
import { emitClaudeAgentToolResultSubagentPart } from "./claude-agent-sdk-subagents";
import {
  type ClaudeTodoProjectionState,
  type ClaudeTodoState,
  retractClaudeTodoToolResults,
} from "./claude-agent-sdk-todos";
import { retractClaudeTranscriptCorrelations } from "./claude-agent-sdk-transcript-correlation";
import {
  readClaudeTurnOriginKind,
  shouldFinalizeClaudeTurn,
} from "./claude-agent-sdk-user-messages";
import { readStringProp } from "./claude-agent-sdk-utils";

const removeClaudeHistoryFinishStep = (message: MutableAssistantHistoryMessage): void => {
  message.parts = message.parts.filter((part) => part.kind !== "step" || part.phase !== "finish");
};

export const toClaudeHistoryMessages = (
  messages: ClaudeHistoryMessage[],
  now: () => string,
  liveUserMessages: readonly ClaudeLiveUserMessage[] = [],
  options: {
    includeNestedEntries?: boolean;
    subagentAgentIdsByToolUseId?: ReadonlyMap<string, string>;
    transcriptExternalSessionId?: string;
  } = {},
): AgentSessionHistoryMessage[] => {
  const history: AgentSessionHistoryMessage[] = [];
  const activeBackgroundSubagentTaskIds = new Set<string>();
  const assistantMessagesByToolCallId = new Map<string, MutableAssistantHistoryMessage>();
  const toolMessageIdsByCallId = new Map<string, string>();
  const toolNamesByCallId = new Map<string, string>();
  const toolInputsByCallId = new Map<string, Record<string, unknown>>();
  const hiddenSubagentTaskIds = new Set<string>();
  const subagentMessageIdsByTaskId = new Map<string, string>();
  const subagentAgentIdsByToolUseId = new Map(options.subagentAgentIdsByToolUseId);
  const subagentTaskIdsByToolUseId = new Map<string, string>();
  const retractedSubagentTaskIds = new Set<string>();
  const retractedToolUseIds = new Set<string>();
  const todosById: ClaudeTodoState = new Map();
  const todoProjectionState: ClaudeTodoProjectionState = { todosById };
  const correlationState = {
    hiddenSubagentTaskIds,
    retractedSubagentTaskIds,
    retractedToolUseIds,
    subagentMessageIdsByTaskId,
    subagentTaskIdsByToolUseId,
    toolMessageIdsByCallId,
    toolNamesByCallId,
  };
  const toolResultState: ClaudeHistoryToolResultState = {
    activeBackgroundSubagentTaskIds,
    assistantMessagesByToolCallId,
    hiddenSubagentTaskIds,
    history,
    retractedSubagentTaskIds,
    retractedToolUseIds,
    subagentAgentIdsByToolUseId,
    subagentMessageIdsByTaskId,
    subagentTaskIdsByToolUseId,
    todoProjectionState,
    todosById,
    toolInputsByCallId,
    toolMessageIdsByCallId,
    toolNamesByCallId,
    transcriptExternalSessionId: options.transcriptExternalSessionId,
  };
  const projectHistoryInput = createClaudeHistoryInputProjector({ liveUserMessages });
  let lastAssistantMessage: MutableAssistantHistoryMessage | null = null;
  let lastAssistantTextMessage: MutableAssistantHistoryMessage | null = null;
  let lastAssistantText: string | undefined;
  let lastFinalAssistantMessage: MutableAssistantHistoryMessage | null = null;
  let lastFinalAssistantText: string | undefined;
  let lastAutonomousFinalAssistantMessage: MutableAssistantHistoryMessage | null = null;
  let assistantTurnOriginKind: string | undefined;
  let pendingManualCompaction: { messageId: string; timestamp: string } | null = null;
  let manualCompactionBoundaryReceived = false;
  let unclaimedManualCompactionBoundary = false;
  const appendOrMergeAssistantSnapshot = (
    snapshot: MutableAssistantHistoryMessage,
  ): MutableAssistantHistoryMessage => {
    const existingMessage = lastAssistantMessage;
    if (existingMessage?.messageId !== snapshot.messageId) {
      history.push(snapshot);
      return snapshot;
    }
    const nextPartIds = new Set(snapshot.parts.map((part) => part.partId));
    // Tool-call maps retain this object, so update it without replacing its identity.
    Object.assign(existingMessage, snapshot, {
      text: snapshot.text.trim().length > 0 ? snapshot.text : existingMessage.text,
      parts: [
        ...existingMessage.parts.filter((part) => !nextPartIds.has(part.partId)),
        ...snapshot.parts,
      ],
    });
    return existingMessage;
  };
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
      const messageText = message.text.trim();
      if (messageText.length > 0) {
        lastAssistantTextMessage = message;
        lastAssistantText = messageText;
      }
      if (messageText.length > 0 && hasFinalStopStep(message)) {
        lastFinalAssistantMessage = message;
        lastFinalAssistantText = messageText;
      }
    }
  };
  const removeRetractedMessages = (messageIds: string[]) => {
    const retractedIds = new Set(messageIds);
    const retractedCorrelations = retractClaudeTranscriptCorrelations(correlationState, messageIds);
    retractClaudeTodoToolResults(todoProjectionState, retractedCorrelations.toolUseIds);
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
      if (
        lastAutonomousFinalAssistantMessage &&
        retractedIds.has(lastAutonomousFinalAssistantMessage.messageId)
      ) {
        lastAutonomousFinalAssistantMessage = null;
      }
      rebuildLastAssistantTracking();
    }
  };
  for (let entryIndex = 0; entryIndex < messages.length; entryIndex += 1) {
    const entry = messages[entryIndex];
    if (!entry) {
      continue;
    }
    const entryValue = entry;
    removeRetractedMessages(retractedHistoryMessageIds(entryValue));
    if (!options.includeNestedEntries && isNestedHistoryEntry(entry)) {
      continue;
    }
    if (entry.type === "user") {
      const originKind = readClaudeTurnOriginKind(entryValue);
      if (originKind !== undefined) {
        if (originKind !== "human" && lastAutonomousFinalAssistantMessage) {
          removeClaudeHistoryFinishStep(lastAutonomousFinalAssistantMessage);
          delete lastAutonomousFinalAssistantMessage.model;
        }
        lastAutonomousFinalAssistantMessage = null;
        assistantTurnOriginKind = originKind;
        resetCurrentUserTurnAssistantTracking();
      }
    }
    const timestamp = readHistoryTimestamp(entry, now);
    const taskNotifications = readClaudeTaskNotifications(entryValue);
    if (taskNotifications.length > 0) {
      for (const notification of taskNotifications) {
        appendClaudeHistorySubagentSystemMessage({
          entry,
          message: toClaudeTaskNotificationMessage(entry, notification),
          state: toolResultState,
          timestamp,
        });
      }
      continue;
    }
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
        lastAutonomousFinalAssistantMessage = null;
        assistantTurnOriginKind = undefined;
        resetCurrentUserTurnAssistantTracking();
        continue;
      }
      lastAssistantMessage = projectedMessage;
      lastAssistantTextMessage = projectedMessage;
      lastAssistantText = projectedMessage.text.trim();
      lastFinalAssistantMessage = projectedMessage;
      lastFinalAssistantText = projectedMessage.text.trim();
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
        isUnknownRecord(entryValue) &&
        isUnknownRecord(entryValue.compact_metadata) &&
        readStringProp(entryValue.compact_metadata, "trigger") === "manual"
      ) {
        unclaimedManualCompactionBoundary = true;
      }
      continue;
    }
    if (isClaudeHistorySubagentSystemMessage(entry)) {
      appendClaudeHistorySubagentSystemMessage({
        entry,
        message: entry,
        state: toolResultState,
        timestamp,
      });
      continue;
    }
    if (entry.type === "user") {
      if (projectClaudeHistoryToolResults({ entry, state: toolResultState, timestamp })) {
        continue;
      }
      continue;
    }
    if (entry.type === "assistant") {
      const projection = projectClaudeHistoryAssistantMessage({
        entry,
        timestamp,
        toolInputsByCallId,
        toolMessageIdsByCallId,
        toolNamesByCallId,
      });
      if (!projection) {
        continue;
      }
      const { message: assistantSnapshot, stopReason } = projection;
      assistantSnapshot.parts = assistantSnapshot.parts.flatMap((part) => {
        if (part.kind !== "tool" || part.tool !== "Agent") {
          return [part];
        }
        const agentId = subagentAgentIdsByToolUseId.get(part.callId);
        if (!agentId) {
          return [part];
        }
        const input = toolInputsByCallId.get(part.callId);
        const subagentEvents: AgentEvent[] = [];
        const subagentResult: Parameters<typeof emitClaudeAgentToolResultSubagentPart>[0] = {
          emit: (event) => subagentEvents.push(event),
          isError: false,
          resultRaw: { agentId, status: "running" },
          resultText: "",
          session: {
            externalSessionId: options.transcriptExternalSessionId ?? readHistorySessionId(entry),
            subagentMessageIdsByTaskId,
            subagentAgentIdsByToolUseId,
            subagentTaskIdsByToolUseId,
            toolInputsByCallId,
            toolMessageIdsByCallId,
            toolNamesByCallId,
            retractedSubagentTaskIds,
            retractedToolUseIds,
          },
          timestamp,
          toolUseId: part.callId,
        };
        if (input) Object.assign(subagentResult, { input });
        emitClaudeAgentToolResultSubagentPart(subagentResult);
        return [
          part,
          ...subagentEvents.flatMap((event) =>
            event.type === "assistant_part" && event.part.kind === "subagent" ? [event.part] : [],
          ),
        ];
      });
      const shouldFinalize = shouldFinalizeClaudeTurn(
        assistantTurnOriginKind,
        activeBackgroundSubagentTaskIds.size,
      );
      if (!shouldFinalize) {
        removeClaudeHistoryFinishStep(assistantSnapshot);
        delete assistantSnapshot.model;
      }
      const assistantMessage = appendOrMergeAssistantSnapshot(assistantSnapshot);
      lastAssistantMessage = assistantMessage;
      const assistantText = assistantMessage.text.trim();
      if (assistantText.length > 0) {
        lastAssistantTextMessage = assistantMessage;
        lastAssistantText = assistantText;
        if (shouldFinalize && isLiveFinalAssistantStopReason(stopReason)) {
          lastFinalAssistantMessage = assistantMessage;
          lastFinalAssistantText = assistantText;
          if (assistantTurnOriginKind && assistantTurnOriginKind !== "human") {
            lastAutonomousFinalAssistantMessage = assistantMessage;
          }
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
      const resultOriginKind = readClaudeTurnOriginKind(entryValue) ?? assistantTurnOriginKind;
      const shouldFinalize = shouldFinalizeClaudeTurn(
        resultOriginKind,
        activeBackgroundSubagentTaskIds.size,
      );
      assistantTurnOriginKind = undefined;
      if (pendingManualCompaction) {
        if (isFailedClaudeResult(entry)) {
          history.push({
            messageId: entry.uuid ?? pendingManualCompaction.messageId,
            role: "system",
            timestamp,
            text: failedClaudeResultText(entry),
            notice: {
              tone: "error",
              reason: "session_error",
              title: "Error",
            },
            parts: [],
          });
        } else if (!manualCompactionBoundaryReceived) {
          history.push({
            messageId: pendingManualCompaction.messageId,
            role: "system",
            timestamp,
            text: successfulClaudeResultText(entry) ?? "No session compaction was needed.",
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
      if (isFailedClaudeResult(entry)) {
        history.push({
          messageId: entry.uuid ?? `claude-result-error:${history.length}`,
          role: "system",
          timestamp,
          text: failedClaudeResultText(entry),
          notice: {
            tone: "error",
            reason: "session_error",
            title: "Error",
          },
          parts: [],
        });
        continue;
      }
      const resultText = successfulClaudeResultText(entry);
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
        };
        if (shouldFinalize) {
          addClaudeHistoryFinishStep(assistantMessage, finishReasonForClaudeResult(entry));
        }
        history.push(assistantMessage);
        lastAssistantMessage = assistantMessage;
        lastAssistantTextMessage = assistantMessage;
        lastAssistantText = resultText;
        if (shouldFinalize) {
          lastFinalAssistantMessage = assistantMessage;
          lastFinalAssistantText = resultText;
          if (resultOriginKind && resultOriginKind !== "human") {
            lastAutonomousFinalAssistantMessage = assistantMessage;
          }
        }
        continue;
      }
      if (!resultTarget) {
        continue;
      }
      if (resultText) {
        moveNestedResultToEnd(history, resultTarget, timestamp, options.includeNestedEntries);
        lastAssistantMessage = resultTarget;
      }
      if (!shouldFinalize) {
        removeClaudeHistoryFinishStep(resultTarget);
      } else {
        addClaudeHistoryFinishStep(resultTarget, finishReasonForClaudeResult(entry));
      }
      if (resultText && shouldFinalize) {
        lastFinalAssistantMessage = resultTarget;
        lastFinalAssistantText = resultText;
        if (resultOriginKind && resultOriginKind !== "human") {
          lastAutonomousFinalAssistantMessage = resultTarget;
        }
      }
    }
  }
  appendUnmatchedLiveUserMessages(history, liveUserMessages);
  return history;
};
