import { AGENT_SESSION_INSTRUCTIONS_UPDATE_PREFIX, type AgentRole } from "@openducktor/core";
import type { AgentChatMessage } from "../../types/agent-orchestrator";
import type { AgentChatToolCallPresentation } from "../send/agent-chat.types";
import { assistantRoleFromMessage, formatTime, SYSTEM_PROMPT_PREFIX } from "./message-formatting";

/** What a transcript message is. Each client draws each kind in its own way. */
export type AgentChatMessageKind = {
  timeLabel: string;
  assistantRole: AgentRole | null;
  systemPromptBody: string;
  /** The role header that kinds without their own header show. */
  showSharedHeader: boolean;
  isReasoningMessage: boolean;
  isAssistantMessage: boolean;
  isUserMessage: boolean;
  isToolMessage: boolean;
  isWorkflowToolMessage: boolean;
  isRegularToolMessage: boolean;
  isSubagentMessage: boolean;
  isSessionNoticeMessage: boolean;
  isSystemPromptMessage: boolean;
  isImageGenerationMessage: boolean;
  /** Kinds that draw a card with their own padding. */
  isRichCardMessage: boolean;
};

export const classifyAgentChatMessage = ({
  message,
  toolCallPresentation,
}: {
  message: AgentChatMessage;
  toolCallPresentation: AgentChatToolCallPresentation | null;
}): AgentChatMessageKind => {
  const timeLabel = message.timestampIsApproximate ? "" : formatTime(message.timestamp);
  const meta = message.meta;
  const isReasoningMessage = meta?.kind === "reasoning";
  const isImageGenerationMessage = meta?.kind === "image_generation";
  const isAssistantMessage = message.role === "assistant" && !isImageGenerationMessage;
  const isUserMessage = message.role === "user";
  const isToolMessage = meta?.kind === "tool";
  const isWorkflowToolMessage =
    isToolMessage &&
    (toolCallPresentation?.kind === "workflow" || toolCallPresentation?.kind === "artifact");
  const isRegularToolMessage = isToolMessage && !isWorkflowToolMessage;
  const isSubagentMessage = meta?.kind === "subagent";
  const isSessionNoticeMessage = meta?.kind === "session_notice";
  const isSystemPromptMessage =
    message.role === "system" && message.content.startsWith(SYSTEM_PROMPT_PREFIX);
  const isRichCardMessage =
    isToolMessage ||
    isSubagentMessage ||
    isSessionNoticeMessage ||
    isSystemPromptMessage ||
    isImageGenerationMessage;
  const systemPromptBody = isSystemPromptMessage
    ? message.content.slice(SYSTEM_PROMPT_PREFIX.length).trimStart()
    : "";
  const showSharedHeader =
    !isImageGenerationMessage &&
    !isUserMessage &&
    !isToolMessage &&
    !isReasoningMessage &&
    !isAssistantMessage &&
    !isSessionNoticeMessage &&
    !isSubagentMessage;

  return {
    timeLabel,
    assistantRole: assistantRoleFromMessage(message),
    systemPromptBody,
    showSharedHeader,
    isReasoningMessage,
    isAssistantMessage,
    isUserMessage,
    isToolMessage,
    isWorkflowToolMessage,
    isRegularToolMessage,
    isSubagentMessage,
    isSessionNoticeMessage,
    isSystemPromptMessage,
    isImageGenerationMessage,
    isRichCardMessage,
  };
};

/** A finished assistant message with text has a copy action. A streaming one does not. */
export const canCopyAssistantMessage = (
  message: AgentChatMessage,
  isStreamingAssistantMessage: boolean,
): boolean =>
  message.role === "assistant" && message.content.trim().length > 0 && !isStreamingAssistantMessage;

/** A system prompt or an instructions update. Both show collapsed behind a toggle. */
export type AgentChatInstructionsMessage = {
  kind: "system_prompt" | "instruction_update";
  toggleLabel: string;
  markdown: string;
};

export const resolveInstructionsMessage = (
  message: AgentChatMessage,
  systemPromptBody: string,
): AgentChatInstructionsMessage | null => {
  if (message.role !== "system") return null;
  if (message.content.startsWith(AGENT_SESSION_INSTRUCTIONS_UPDATE_PREFIX)) {
    return {
      kind: "instruction_update",
      toggleLabel: "Show instruction update",
      markdown: message.content.slice(AGENT_SESSION_INSTRUCTIONS_UPDATE_PREFIX.length),
    };
  }
  if (!message.content.startsWith(SYSTEM_PROMPT_PREFIX)) return null;
  return { kind: "system_prompt", toggleLabel: "Show system prompt", markdown: systemPromptBody };
};
