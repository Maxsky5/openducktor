import type { AgentSessionHistoryMessage, AgentStreamPart } from "@openducktor/core";
import { readHistoryAssistantModel } from "./claude-agent-sdk-history-entry";
import type { ClaudeHistoryMessage } from "./claude-agent-sdk-history-import";
import { parseClaudeHistoryAssistantEntry } from "./claude-agent-sdk-ingress-schemas";
import { isClaudeSyntheticAssistantMessage } from "./claude-agent-sdk-local-commands";
import { finishReasonForClaudeStopReason } from "./claude-agent-sdk-result-lifecycle";
import {
  createClaudePendingToolPart,
  decodeClaudeToolUseBlock,
  isClaudeToolUseBlockType,
} from "./claude-agent-sdk-tool-shapes";
import {
  createClaudeFinishStepPart,
  createClaudeAssistantTextPart,
  projectClaudeAssistantBlock,
} from "./claude-agent-sdk-transcript-parts";
import type { ClaudeToolInput } from "./claude-agent-sdk-types";
import { historyMessageText, readStringProp } from "./claude-agent-sdk-utils";

export type MutableAssistantHistoryMessage = Extract<
  AgentSessionHistoryMessage,
  { role: "assistant" }
>;

type SystemMessage = Extract<AgentSessionHistoryMessage, { role: "system" }>;
type ErrorNotice = SystemMessage & {
  notice: Extract<NonNullable<SystemMessage["notice"]>, { reason: "session_error" }>;
};

export const toAssistantErrorNotice = (
  entry: ClaudeHistoryMessage,
  timestamp: string,
): ErrorNotice | null => {
  const error = readStringProp(entry, "error");
  if (entry.type !== "assistant" || !error) return null;
  const assistant = parseClaudeHistoryAssistantEntry(entry).message;
  const message: ErrorNotice = {
    messageId: readStringProp(assistant, "id") ?? entry.uuid,
    role: "system",
    timestamp,
    text: historyMessageText(assistant) || `Claude API error: ${error}`,
    notice: { tone: "error", reason: "session_error", title: "Error" },
    parts: [],
  };
  if (error === "rate_limit") message.notice.usageLimit = {};
  return message;
};

/** Tool-call maps retain this object, so merge snapshots without replacing its identity. */
export const updateClaudeHistoryAssistantSnapshot = (
  current: MutableAssistantHistoryMessage,
  snapshot: MutableAssistantHistoryMessage,
): void => {
  const nextParts = new Map(snapshot.parts.map((part) => [part.partId, part]));
  const existingPartIds = new Set(current.parts.map((part) => part.partId));
  const parts = [
    ...current.parts.map((part) => nextParts.get(part.partId) ?? part),
    ...snapshot.parts.filter((part) => !existingPartIds.has(part.partId)),
  ];
  if (snapshot.text.trim().length > 0 && !snapshot.parts.some((part) => part.kind === "text")) {
    // Final text completes the last streamed text row instead of adding a second row.
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const part = parts[index];
      if (part?.kind !== "text") continue;
      parts[index] = createClaudeAssistantTextPart({
        messageId: snapshot.messageId,
        partId: part.partId,
        text: snapshot.text,
      });
      break;
    }
  }
  Object.assign(current, snapshot, {
    text: snapshot.text.trim().length > 0 ? snapshot.text : current.text,
    parts,
  });
};

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

export const removeClaudeHistoryFinishStep = (message: MutableAssistantHistoryMessage): void => {
  message.parts = message.parts.filter((part) => part.kind !== "step" || part.phase !== "finish");
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
  toolInputsByCallId: Map<string, ClaudeToolInput>;
  toolMessageIdsByCallId: Map<string, string>;
  toolNamesByCallId: Map<string, string>;
};

type ClaudeHistoryAssistantProjection = {
  message: MutableAssistantHistoryMessage;
  stopReason: string | undefined;
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
  const assistantEntry = parseClaudeHistoryAssistantEntry(entry);
  const responseId = readStringProp(assistantEntry.message, "id");
  const content = assistantEntry.message.content;
  const text = historyMessageText(assistantEntry.message);
  const parts: AgentStreamPart[] = [];
  const stopReason = readStringProp(assistantEntry.message, "stop_reason");
  const messageId = responseId ?? entry.uuid;
  const hasToolUse = content.some((block) =>
    isClaudeToolUseBlockType(readStringProp(block, "type")),
  );
  for (const [index, block] of content.entries()) {
    const type = readStringProp(block, "type");
    const part = projectClaudeAssistantBlock({ block, index, messageId, hasToolUse });
    if (part) {
      // Final text uses the response identity, as the live assistant_message does.
      if (part.kind !== "text" || hasToolUse || !isLiveFinalAssistantStopReason(stopReason)) {
        parts.push(part);
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
  };
  if (model) {
    assistantMessage.model = model;
  }
  if (text.trim().length > 0) {
    addClaudeHistoryFinishStep(assistantMessage, finishReasonForClaudeStopReason(stopReason));
  }
  return { message: assistantMessage, stopReason };
};
