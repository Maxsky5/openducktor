import type {
  AgentEvent,
  AgentSessionHistoryMessage,
  AgentSkillReference,
  AgentStreamPart,
} from "@openducktor/core";
import { readClaudeFileEditPayload } from "./claude-agent-sdk-file-edits";
import {
  isNestedHistoryEntry,
  readHistoryAssistantModel,
  readHistorySessionId,
  readHistoryTimestamp,
} from "./claude-agent-sdk-history-entry";
import {
  type ClaudeHistoryMessage,
  type ClaudeHistoryResultMessage,
  isClaudeHistorySubagentSystemMessage,
} from "./claude-agent-sdk-history-import";
import {
  type ClaudeLiveUserMessage,
  createHistoryToolPart,
  createLiveUserMessageIdResolver,
  hasFinalStopStep,
  readClaudeHistoryDisplayParts,
  readHistoryToolResults,
  retractedHistoryMessageIds,
} from "./claude-agent-sdk-history-support";
import {
  finishReasonForClaudeResult,
  finishReasonForClaudeStopReason,
  isFailedClaudeResult,
  readClaudeResultDurationMs,
} from "./claude-agent-sdk-result-lifecycle";
import {
  emitClaudeAgentToolResultSubagentPart,
  handleClaudeSubagentSystemMessage,
} from "./claude-agent-sdk-subagents";
import { isClaudeToolUseBlockType, timestampMs } from "./claude-agent-sdk-tool-shapes";
import {
  historyMessageText,
  isRecord,
  readStringProp,
  toolPartType,
} from "./claude-agent-sdk-utils";

type MutableAssistantHistoryMessage = Extract<AgentSessionHistoryMessage, { role: "assistant" }>;

const successfulResultText = (entry: ClaudeHistoryResultMessage): string | null => {
  if (isFailedClaudeResult(entry)) {
    return null;
  }
  const text = typeof entry.result === "string" ? entry.result.trim() : "";
  return text.length > 0 ? text : null;
};

const isLiveFinalAssistantStopReason = (stopReason: string | undefined): boolean =>
  stopReason === "end_turn" || stopReason === "stop_sequence";

const messageContent = (message: unknown): unknown =>
  isRecord(message) ? message.content : undefined;

const assistantMessageStopReason = (entry: ClaudeHistoryMessage): string | undefined =>
  isRecord(entry) ? readStringProp(entry.message, "stop_reason") : undefined;

const hasToolUseContentBlock = (content: unknown): boolean =>
  Array.isArray(content) &&
  content.some(
    (block) => isRecord(block) && isClaudeToolUseBlockType(readStringProp(block, "type")),
  );

const isSupersededTextOnlyToolUseDraft = (
  messages: ClaudeHistoryMessage[],
  entryIndex: number,
  text: string,
  options: { includeNestedEntries?: boolean },
): boolean => {
  for (let index = entryIndex + 1; index < messages.length; index += 1) {
    const candidate = messages[index];
    if (!candidate) {
      continue;
    }
    if (!options.includeNestedEntries && isNestedHistoryEntry(candidate)) {
      continue;
    }
    if (candidate.type === "user" || candidate.type === "result") {
      return false;
    }
    if (candidate.type !== "assistant") {
      continue;
    }
    if (assistantMessageStopReason(candidate) !== "tool_use") {
      return false;
    }
    if (historyMessageText(candidate.message).trim() !== text) {
      return false;
    }
    return hasToolUseContentBlock(messageContent(candidate.message));
  }
  return false;
};

const addFinishStep = (message: MutableAssistantHistoryMessage, reason: string | null): void => {
  if (!reason) {
    return;
  }
  const partId = `${message.messageId}:finish`;
  if (message.parts.some((part) => part.kind === "step" && part.partId === partId)) {
    return;
  }
  message.parts.push({
    kind: "step",
    messageId: message.messageId,
    partId,
    phase: "finish",
    reason,
  });
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
  const hiddenSubagentTaskIds = new Set<string>();
  const subagentMessageIdsByTaskId = new Map<string, string>();
  const subagentTaskIdsByToolUseId = new Map<string, string>();
  const resolveLiveUserMessageId = createLiveUserMessageIdResolver(liveUserMessages);
  let lastAssistantMessage: MutableAssistantHistoryMessage | null = null;
  let lastAssistantTextMessage: MutableAssistantHistoryMessage | null = null;
  let lastAssistantText: string | undefined;
  let lastFinalAssistantMessage: MutableAssistantHistoryMessage | null = null;
  let lastFinalAssistantText: string | undefined;
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
    let removed = false;
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const message = history[index];
      if (!message || !retractedIds.has(message.messageId)) {
        continue;
      }
      history.splice(index, 1);
      removed = true;
      if (message.role !== "assistant") {
        continue;
      }
      for (const part of message.parts) {
        if (part.kind === "tool") {
          assistantMessagesByToolCallId.delete(part.callId);
          toolNamesByCallId.delete(part.callId);
        }
      }
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
          const completedPart: Extract<AgentStreamPart, { kind: "tool" }> = {
            kind: "tool",
            messageId: existingMessage?.messageId ?? entry.uuid ?? toolResult.toolUseId,
            partId: toolResult.toolUseId,
            callId: toolResult.toolUseId,
            tool,
            toolType: toolPartType(tool),
            status: toolResult.isError ? "error" : "completed",
            ...(existingPart?.input ? { input: existingPart.input } : {}),
            ...(existingPart?.preview ? { preview: existingPart.preview } : {}),
            ...(existingPart?.metadata ? { metadata: existingPart.metadata } : {}),
            ...(typeof existingPart?.startedAtMs === "number"
              ? { startedAtMs: existingPart.startedAtMs }
              : {}),
            endedAtMs: timestampMs(timestamp),
            ...(toolResult.isError ? { error: toolResult.text } : { output: toolResult.text }),
          };
          if (!toolResult.isError) {
            Object.assign(
              completedPart,
              readClaudeFileEditPayload({
                tool,
                input: existingPart?.input,
                raw: toolResult.raw,
              }),
            );
          }
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
              },
              timestamp,
              toolUseId: toolResult.toolUseId,
              ...(existingPart?.input ? { input: existingPart.input } : {}),
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
      if (entry.parent_tool_use_id) {
        continue;
      }
      const text = historyMessageText(entry.message);
      const fallbackMessageId = entry.uuid ?? `claude-user:${history.length}`;
      const displayParts = readClaudeHistoryDisplayParts(
        fallbackMessageId,
        entry.message,
        options.skills,
      );
      if (text.trim().length === 0 && displayParts.length === 0) {
        continue;
      }
      history.push({
        messageId: resolveLiveUserMessageId(fallbackMessageId, text),
        role: "user",
        timestamp,
        text,
        displayParts,
        state: "read",
        parts: [],
      });
      resetCurrentUserTurnAssistantTracking();
      continue;
    }
    if (entry.type === "assistant") {
      const text = historyMessageText(entry.message);
      const parts: AgentStreamPart[] = [];
      const content = isRecord(entry.message) ? entry.message.content : undefined;
      const stopReason = isRecord(entry.message)
        ? readStringProp(entry.message, "stop_reason")
        : undefined;
      const preservesBlockOrder =
        stopReason === "tool_use" &&
        Array.isArray(content) &&
        content.some((block) => isRecord(block) && readStringProp(block, "type") !== "text");
      if (Array.isArray(content)) {
        for (const [index, block] of content.entries()) {
          if (!isRecord(block)) {
            continue;
          }
          const type = readStringProp(block, "type");
          if (type === "text" && preservesBlockOrder) {
            const blockText = readStringProp(block, "text");
            if (blockText && blockText.trim().length > 0) {
              parts.push({
                kind: "text",
                messageId: entry.uuid,
                partId: `${entry.uuid}:text:${index}`,
                text: blockText,
                completed: true,
              });
            }
            continue;
          }
          if (isClaudeToolUseBlockType(type)) {
            const part = createHistoryToolPart(entry.uuid, block, index, timestamp);
            if (part) {
              parts.push(part);
              toolMessageIdsByCallId.set(part.callId, entry.uuid);
              toolNamesByCallId.set(part.callId, part.tool);
            }
            continue;
          }
          if (type === "thinking") {
            const thinkingText = readStringProp(block, "thinking") ?? readStringProp(block, "text");
            if (thinkingText) {
              parts.push({
                kind: "reasoning",
                messageId: entry.uuid,
                partId: `${entry.uuid}:thinking:${index}`,
                text: thinkingText,
                completed: true,
              });
            }
          }
        }
      }
      if (stopReason === "tool_use" && text.trim().length > 0 && parts.length === 0) {
        if (isSupersededTextOnlyToolUseDraft(messages, entryIndex, text.trim(), options)) {
          continue;
        }
      }
      if (text.trim().length === 0 && parts.length === 0) {
        continue;
      }
      const model = readHistoryAssistantModel(entry);
      const assistantMessage: MutableAssistantHistoryMessage = {
        messageId: entry.uuid,
        role: "assistant",
        timestamp,
        text,
        parts,
        ...(model ? { model } : {}),
      };
      // Compatible models may persist reasoning-only end-turn frames before the
      // visible final answer. They are internal frames, not completed transcript turns.
      if (text.trim().length > 0) {
        addFinishStep(assistantMessage, finishReasonForClaudeStopReason(stopReason));
      }
      history.push(assistantMessage);
      lastAssistantMessage = assistantMessage;
      if (text.trim().length > 0) {
        lastAssistantTextMessage = assistantMessage;
        lastAssistantText = text;
        if (isLiveFinalAssistantStopReason(stopReason)) {
          lastFinalAssistantMessage = assistantMessage;
          lastFinalAssistantText = text;
        }
      }
      for (const part of parts) {
        if (part.kind === "tool") {
          assistantMessagesByToolCallId.set(part.callId, assistantMessage);
        }
      }
      continue;
    }
    if (entry.type === "result") {
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
        addFinishStep(assistantMessage, finishReasonForClaudeResult(entry));
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
      addFinishStep(resultTarget, finishReasonForClaudeResult(entry));
      if (resultText) {
        lastFinalAssistantMessage = resultTarget;
        lastFinalAssistantText = resultText;
      }
    }
  }
  return history;
};
