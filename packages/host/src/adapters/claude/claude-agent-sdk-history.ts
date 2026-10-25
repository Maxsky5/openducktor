import type { AgentEvent, AgentSessionHistoryMessage } from "@openducktor/core";
import { z } from "zod";
import { CLAUDE_COMPACTED_MESSAGE } from "./claude-agent-sdk-compaction";
import {
  addClaudeHistoryFinishStep,
  clearClaudeHistoryAssistantFinality,
  isLiveFinalAssistantStopReason,
  type MutableAssistantHistoryMessage,
  moveNestedResultToEnd,
  projectClaudeHistoryAssistantMessage,
  toAssistantErrorNotice,
  updateClaudeHistoryAssistantSnapshot,
} from "./claude-agent-sdk-history-assistant";
import {
  isNestedHistoryEntry,
  readHistorySessionId,
  readHistoryTimestamp,
} from "./claude-agent-sdk-history-entry";
import { readClaudeHistoryAssistantTracking } from "./claude-agent-sdk-history-finality";
import { claudeReplyDurationMs } from "./claude-agent-sdk-message-timestamp";
import {
  type ClaudeHistoryMessage,
  isClaudeHistoryBackgroundTasksChangedMessage,
  isClaudeHistoryCompactBoundaryMessage,
  isClaudeHistorySubagentSystemMessage,
} from "./claude-agent-sdk-history-messages";
import { toClaudeTaskNotificationMessage } from "./claude-agent-sdk-history-notifications";
import {
  createClaudeHistoryInputProjector,
  type ManualCompactionInput,
} from "./claude-agent-sdk-history-input";
import {
  mergeUnmatchedLiveUserMessages,
  hasFinalStopStep,
  type ClaudeLiveUserMessage,
  retractedHistoryMessageIds,
} from "./claude-agent-sdk-history-support";
import {
  applyClaudeHistoryActiveTasks,
  applyClaudeHistoryTaskSnapshot,
  appendClaudeHistorySubagentSystemMessage,
  type ClaudeHistoryToolResultState,
  applyClaudeHistoryToolUses,
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
import type { ClaudeToolInput } from "./claude-agent-sdk-types";
import { readClaudeTurnOriginKind } from "./claude-agent-sdk-user-messages";
import { readStringProp } from "./claude-agent-sdk-utils";

const claudeCompactMetadataSchema = z.object({ trigger: z.string().optional() });

export const toClaudeHistoryMessages = (
  messages: readonly ClaudeHistoryMessage[],
  now: () => string,
  liveUserMessages: readonly ClaudeLiveUserMessage[] = [],
  options: {
    currentBackgroundTaskIds?: ReadonlySet<string>;
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
  const toolInputsByCallId = new Map<string, ClaudeToolInput>();
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
  const projectHistoryInput = createClaudeHistoryInputProjector({ ...options, liveUserMessages });
  let lastAssistantMessage: MutableAssistantHistoryMessage | null = null;
  let lastError: ReturnType<typeof toAssistantErrorNotice> = null;
  let lastAssistantTextMessage: MutableAssistantHistoryMessage | null = null;
  let lastAssistantText: string | undefined;
  let lastFinalAssistantMessage: MutableAssistantHistoryMessage | null = null;
  let lastFinalAssistantText: string | undefined;
  let replyStartedAt: string | undefined;
  let pendingManualCompaction: ManualCompactionInput | null = null;
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
    updateClaudeHistoryAssistantSnapshot(existingMessage, snapshot);
    return existingMessage;
  };
  const resetCurrentUserTurnAssistantTracking = () => {
    lastError = null;
    lastAssistantMessage = null;
    lastAssistantTextMessage = null;
    lastAssistantText = undefined;
    lastFinalAssistantMessage = null;
    lastFinalAssistantText = undefined;
  };
  const removeRetractedMessages = (messageIds: string[]) => {
    if (messageIds.length === 0) return;
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
      lastError = null;
      ({
        lastAssistantMessage,
        lastAssistantTextMessage,
        lastAssistantText,
        lastFinalAssistantMessage,
        lastFinalAssistantText,
      } = readClaudeHistoryAssistantTracking(history));
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
    if (entry.type === "user") {
      if (entry.interruptedByShutdown === true) {
        if (lastFinalAssistantMessage)
          clearClaudeHistoryAssistantFinality(lastFinalAssistantMessage);
        replyStartedAt = undefined;
        resetCurrentUserTurnAssistantTracking();
      }
      const originKind = readClaudeTurnOriginKind(entry);
      if (originKind !== undefined && originKind !== "human") {
        replyStartedAt = readStringProp(entry, "timestamp");
        resetCurrentUserTurnAssistantTracking();
      }
    }
    const timestamp = readHistoryTimestamp(entry, now);
    const taskNotifications = readClaudeTaskNotifications(entry);
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
    if (entry.type === "user") {
      projectClaudeHistoryToolResults({ entry, state: toolResultState, timestamp });
    }
    const projectedInput = projectHistoryInput(entry, timestamp);
    if (projectedInput.handled) {
      if (projectedInput.manualCompaction) {
        replyStartedAt = undefined;
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
      if (projectedMessage.role === "user") {
        // Native history can omit a notification's result and assistant output.
        const previous = history.findLast((message) => message.role !== "system");
        history.push(projectedMessage);
        // Steering keeps the first prompt's start, even before assistant output.
        if (!lastAssistantMessage || hasFinalStopStep(lastAssistantMessage)) {
          if (
            lastAssistantMessage ||
            (previous?.role === "assistant" && hasFinalStopStep(previous))
          )
            replyStartedAt = undefined;
          replyStartedAt ??= readStringProp(entry, "timestamp");
          resetCurrentUserTurnAssistantTracking();
        }
        continue;
      }
      history.push(projectedMessage);
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
      } else {
        const parsedCompactMetadata = claudeCompactMetadataSchema.safeParse(entry.compact_metadata);
        if (parsedCompactMetadata.success && parsedCompactMetadata.data.trigger === "manual") {
          unclaimedManualCompactionBoundary = true;
        }
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
    if (isClaudeHistoryBackgroundTasksChangedMessage(entry)) {
      applyClaudeHistoryTaskSnapshot(toolResultState, entry, timestamp);
      continue;
    }
    if (entry.type === "assistant") {
      const errorMessage = toAssistantErrorNotice(entry, timestamp);
      if (errorMessage) {
        removeRetractedMessages([errorMessage.messageId]);
        lastError = errorMessage;
        history.push(errorMessage);
        continue;
      }
      lastError = null;
      const projection = projectClaudeHistoryAssistantMessage({
        entry,
        timestamp,
        toolInputsByCallId,
        toolMessageIdsByCallId,
        toolNamesByCallId,
      });
      if (!projection) continue;
      const { message: assistantSnapshot, stopReason } = projection;
      applyClaudeHistoryToolUses(toolResultState, assistantSnapshot, timestamp);
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
        if (input) {
          subagentResult.input = input;
        }
        emitClaudeAgentToolResultSubagentPart(subagentResult);
        return [
          part,
          ...subagentEvents.flatMap((event) =>
            event.type === "assistant_part" && event.part.kind === "subagent" ? [event.part] : [],
          ),
        ];
      });
      if (assistantSnapshot.text.trim().length > 0 && isLiveFinalAssistantStopReason(stopReason)) {
        const durationMs = claudeReplyDurationMs(
          replyStartedAt,
          readStringProp(entry, "timestamp"),
        );
        if (durationMs !== undefined) assistantSnapshot.durationMs = durationMs;
      }
      const assistantMessage = appendOrMergeAssistantSnapshot(assistantSnapshot);
      lastAssistantMessage = assistantMessage;
      const assistantText = assistantMessage.text.trim();
      if (assistantText.length > 0) {
        lastAssistantTextMessage = assistantMessage;
        lastAssistantText = assistantText;
        if (isLiveFinalAssistantStopReason(stopReason)) {
          lastFinalAssistantMessage = assistantMessage;
          lastFinalAssistantText = assistantText;
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
      const durationMs = claudeReplyDurationMs(replyStartedAt, readStringProp(entry, "timestamp"));
      replyStartedAt = undefined;
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
          // A Claude result is a status or a no-op reason, not compaction context.
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
        if (lastError) {
          lastError.text = failedClaudeResultText(entry);
          lastError.timestamp = timestamp;
          resetCurrentUserTurnAssistantTracking();
          continue;
        }
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
        resetCurrentUserTurnAssistantTracking();
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
        addClaudeHistoryFinishStep(assistantMessage, finishReasonForClaudeResult(entry));
        if (durationMs !== undefined) assistantMessage.durationMs = durationMs;
        history.push(assistantMessage);
        lastAssistantMessage = assistantMessage;
        lastAssistantTextMessage = assistantMessage;
        lastAssistantText = resultText;
        lastFinalAssistantMessage = assistantMessage;
        lastFinalAssistantText = resultText;
        continue;
      }
      if (!resultTarget) continue;
      if (resultText) {
        moveNestedResultToEnd(history, resultTarget, timestamp, options.includeNestedEntries);
        lastAssistantMessage = resultTarget;
      }
      addClaudeHistoryFinishStep(resultTarget, finishReasonForClaudeResult(entry));
      if (resultTarget.durationMs === undefined && durationMs !== undefined)
        resultTarget.durationMs = durationMs;
      if (resultText) {
        lastFinalAssistantMessage = resultTarget;
        lastFinalAssistantText = resultText;
      }
    }
  }
  applyClaudeHistoryActiveTasks(toolResultState, options.currentBackgroundTaskIds, now);
  return mergeUnmatchedLiveUserMessages(history, liveUserMessages);
};
