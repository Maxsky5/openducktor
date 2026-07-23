import type { AgentSessionHistoryMessage, AgentStreamPart } from "@openducktor/core";
import { isSupersededTextOnlyToolUseDraft } from "./claude-agent-sdk-history-drafts";
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

type ProjectClaudeHistoryAssistantMessageInput = {
  entry: ClaudeHistoryMessage;
  entryIndex: number;
  messages: ClaudeHistoryMessage[];
  options: { includeNestedEntries?: boolean };
  timestamp: string;
  toolInputsByCallId: Map<string, Record<string, unknown>>;
  toolMessageIdsByCallId: Map<string, string>;
  toolNamesByCallId: Map<string, string>;
};

type ClaudeHistoryAssistantProjection = {
  message: MutableAssistantHistoryMessage;
  stopReason: string | undefined;
};

export const projectClaudeHistoryAssistantMessage = ({
  entry,
  entryIndex,
  messages,
  options,
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
          parts.push(
            createClaudeAssistantTextPart({
              messageId: entry.uuid,
              partId: `${entry.uuid}:text:${index}`,
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
          parts.push(createClaudePendingToolPart({ messageId: entry.uuid, toolUse }));
          toolMessageIdsByCallId.set(toolUse.callId, entry.uuid);
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
              messageId: entry.uuid,
              partId: `${entry.uuid}:thinking:${index}`,
              text: thinkingText,
            }),
          );
        }
      }
    }
  }
  if (
    stopReason === "tool_use" &&
    text.trim().length > 0 &&
    parts.length === 0 &&
    isSupersededTextOnlyToolUseDraft(messages, entryIndex, text.trim(), options)
  ) {
    return null;
  }
  if (text.trim().length === 0 && parts.length === 0) {
    return null;
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
  if (text.trim().length > 0) {
    addClaudeHistoryFinishStep(assistantMessage, finishReasonForClaudeStopReason(stopReason));
  }
  return { message: assistantMessage, stopReason };
};
