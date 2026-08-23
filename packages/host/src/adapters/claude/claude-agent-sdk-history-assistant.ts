import type { AgentSessionHistoryMessage, AgentStreamPart } from "@openducktor/core";
import { readHistoryAssistantModel } from "./claude-agent-sdk-history-entry";
import type { ClaudeHistoryMessage } from "./claude-agent-sdk-history-import";
import { isClaudeSyntheticAssistantMessage } from "./claude-agent-sdk-local-commands";
import { finishReasonForClaudeStopReason } from "./claude-agent-sdk-result-lifecycle";
import {
  createClaudePendingToolPart,
  decodeClaudeToolUseBlock,
  isClaudeToolUseBlockType,
} from "./claude-agent-sdk-tool-shapes";
import {
  createClaudeAssistantReasoningPart,
  createClaudeAssistantTextPart,
  createClaudeFinishStepPart,
} from "./claude-agent-sdk-transcript-parts";
import { historyMessageText, isRecord, readStringProp } from "./claude-agent-sdk-utils";

export type MutableAssistantHistoryMessage = Extract<
  AgentSessionHistoryMessage,
  { role: "assistant" }
>;

export const addClaudeHistoryFinishStep = (
  message: MutableAssistantHistoryMessage,
  reason: string | null,
): void => {
  if (!reason) {
    return;
  }
  const part = createClaudeFinishStepPart({ messageId: message.messageId, reason });
  if (
    message.parts.some((candidate) => candidate.kind === "step" && candidate.partId === part.partId)
  ) {
    return;
  }
  message.parts.push(part);
};

export const isLiveFinalAssistantStopReason = (stopReason: string | undefined): boolean =>
  stopReason === "end_turn" || stopReason === "stop_sequence";

export const moveNestedResultToEnd = (
  history: AgentSessionHistoryMessage[],
  message: MutableAssistantHistoryMessage,
  timestamp: string,
  includeNestedEntries: boolean | undefined,
): void => {
  if (!includeNestedEntries) {
    return;
  }
  const index = history.indexOf(message);
  if (index < 0 || index === history.length - 1) {
    return;
  }
  history.splice(index, 1);
  message.timestamp = timestamp;
  history.push(message);
};

type ProjectClaudeHistoryAssistantMessageInput = {
  entry: ClaudeHistoryMessage;
  timestamp: string;
  toolInputsByCallId: Map<string, Record<string, unknown>>;
  toolMessageIdsByCallId: Map<string, string>;
  toolNamesByCallId: Map<string, string>;
};

type ClaudeHistoryAssistantProjection = {
  message: MutableAssistantHistoryMessage;
  stopReason: string | undefined;
};

const claudeAssistantResponseId = (entry: ClaudeHistoryMessage): string | undefined => {
  return entry.type === "assistant" && isRecord(entry.message)
    ? readStringProp(entry.message, "id")
    : undefined;
};

const claudeAssistantContent = (entry: ClaudeHistoryMessage): unknown[] => {
  return entry.type === "assistant" && isRecord(entry.message)
    ? Array.isArray(entry.message.content)
      ? entry.message.content
      : []
    : [];
};

export const projectClaudeHistoryAssistantMessage = ({
  entry,
  timestamp,
  toolInputsByCallId,
  toolMessageIdsByCallId,
  toolNamesByCallId,
}: ProjectClaudeHistoryAssistantMessageInput): ClaudeHistoryAssistantProjection | null => {
  if (entry.type !== "assistant") {
    return null;
  }
  if (isClaudeSyntheticAssistantMessage(entry)) {
    return null;
  }
  const responseId = claudeAssistantResponseId(entry);
  const content = claudeAssistantContent(entry);
  const text = historyMessageText(entry.message);
  const parts: AgentStreamPart[] = [];
  const stopReason = isRecord(entry.message)
    ? readStringProp(entry.message, "stop_reason")
    : undefined;
  const messageId = responseId ?? entry.uuid;
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
        if (blockText?.trim()) {
          parts.push(
            createClaudeAssistantTextPart({
              messageId,
              partId: `${messageId}:text:${index}`,
              text: blockText,
            }),
          );
        }
        continue;
      }
      if (isClaudeToolUseBlockType(type)) {
        const toolUse = decodeClaudeToolUseBlock({
          block,
          fallbackMessageId: entry.uuid,
          index,
        });
        if (toolUse) {
          parts.push(createClaudePendingToolPart({ messageId, toolUse }));
          toolMessageIdsByCallId.set(toolUse.callId, messageId);
          toolNamesByCallId.set(toolUse.callId, toolUse.toolName);
          if (toolUse.input) {
            toolInputsByCallId.set(toolUse.callId, toolUse.input);
          }
        }
        continue;
      }
      if (type === "thinking") {
        const thinkingText = readStringProp(block, "thinking") ?? readStringProp(block, "text");
        if (thinkingText) {
          parts.push(
            createClaudeAssistantReasoningPart({
              messageId,
              partId: `${messageId}:thinking:${index}`,
              text: thinkingText,
            }),
          );
        }
      }
    }
  }
  if (text.trim().length === 0 && parts.length === 0) {
    return null;
  }
  const model = readHistoryAssistantModel(entry);
  const assistantMessage: MutableAssistantHistoryMessage = {
    messageId,
    role: "assistant",
    timestamp,
    text,
    parts,
    ...(model ? { model } : undefined),
  };
  if (text.trim().length > 0) {
    addClaudeHistoryFinishStep(assistantMessage, finishReasonForClaudeStopReason(stopReason));
  }
  return { message: assistantMessage, stopReason };
};
