import { isUnknownRecord, type AgentEvent } from "@openducktor/core";
import {
  type ClaudeEventSession,
  claudeSubagentEventSession,
} from "./claude-agent-sdk-event-session";
import { readClaudeHistoryDisplayParts } from "./claude-agent-sdk-history-support";
import { isClaudeSubagentTranscriptTarget } from "./claude-agent-sdk-subagent-transcripts";
import { decodeClaudeToolResultValue } from "./claude-agent-sdk-tool-shapes";
import { isClaudeHumanUserMessage } from "./claude-agent-sdk-user-messages";
import { historyMessageText, readStringProp } from "./claude-agent-sdk-utils";
import type {
  ClaudeSdkMessageProjection,
  ClaudeSdkUserMessageProjection,
} from "./claude-agent-sdk-message-projection";

type ForwardedClaudeSubagentMessage = {
  message: ClaudeSdkMessageProjection;
  session: ClaudeEventSession;
};

const hasToolResultForParent = (
  message: ClaudeSdkUserMessageProjection,
  parentToolUseId: string,
): boolean => {
  const content = message.message.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      const result = decodeClaudeToolResultValue(block, null);
      if (result?.toolUseId === parentToolUseId) {
        return true;
      }
    }
  }
  const directResult = decodeClaudeToolResultValue(message.tool_use_result, parentToolUseId, {
    allowNonToolResultType: true,
  });
  return directResult?.toolUseId === parentToolUseId;
};

const isClaudeToolResultUserMessage = (message: ClaudeSdkUserMessageProjection): boolean => {
  const content = message.message.content;
  if (
    Array.isArray(content) &&
    content.some((block) => {
      const contentBlock = block;
      return (
        isUnknownRecord(contentBlock) &&
        (readStringProp(contentBlock, "type") === "tool_result" ||
          readStringProp(contentBlock, "type") === "mcp_tool_result")
      );
    })
  ) {
    return true;
  }
  return isUnknownRecord(message.tool_use_result);
};

export const emitClaudeSubagentUserMessage = ({
  emit,
  message,
  session,
  timestamp,
}: {
  emit: (event: AgentEvent) => void;
  message: ClaudeSdkUserMessageProjection;
  session: ClaudeEventSession;
  timestamp: string;
}): void => {
  const messageValue = message;
  const content = message.message;
  if (
    !isClaudeSubagentTranscriptTarget(session.externalSessionId) ||
    isClaudeToolResultUserMessage(message) ||
    !isClaudeHumanUserMessage(messageValue)
  ) {
    return;
  }
  const messageId = message.uuid ?? `claude-user:${session.externalSessionId}:${timestamp}`;
  const text = historyMessageText(content);
  const parts = readClaudeHistoryDisplayParts(messageId, content);
  if (text.length === 0 && parts.length === 0) {
    return;
  }
  emit({
    type: "user_message",
    externalSessionId: session.externalSessionId,
    timestamp,
    messageId,
    message: text,
    parts,
    state: "read",
  });
};

const forwardedSubagentParentToolUseId = (message: ClaudeSdkMessageProjection): string | null => {
  if (message.type !== "assistant" && message.type !== "user" && message.type !== "tool_progress") {
    return null;
  }
  const parentToolUseId = message.parent_tool_use_id;
  if (!parentToolUseId) {
    return null;
  }
  if (message.type === "user" && hasToolResultForParent(message, parentToolUseId)) {
    return null;
  }
  return parentToolUseId;
};

export const resolveForwardedClaudeSubagentMessage = (
  session: ClaudeEventSession,
  message: ClaudeSdkMessageProjection,
): ForwardedClaudeSubagentMessage | null | undefined => {
  const parentToolUseId = forwardedSubagentParentToolUseId(message);
  if (!parentToolUseId) {
    return undefined;
  }
  const childSession = claudeSubagentEventSession(session, parentToolUseId);
  if (!childSession) {
    return null;
  }
  const forwardedMessage: ClaudeSdkMessageProjection =
    "parent_tool_use_id" in message ? { ...message, parent_tool_use_id: null } : message;
  return {
    message: forwardedMessage,
    session: childSession,
  };
};
