import {
  type AgentModelSelection,
  type AgentRole,
  isOdtWorkflowMutationToolName,
} from "@openducktor/core";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import { resolveAgentAccentColor } from "../agent-accent-color";
import {
  assistantRoleFromMessage,
  formatTime,
  getToolLifecyclePhase,
  SYSTEM_PROMPT_PREFIX,
} from "./agent-chat-message-card-model";

type AgentChatMessageCardViewModelInput = {
  message: AgentChatMessage;
  sessionRole: AgentRole | null;
  sessionSelectedModel: AgentModelSelection | null;
  sessionAgentColors: Record<string, string> | undefined;
};

type AgentChatMessageCardViewModel = {
  timeLabel: string;
  assistantRole: AgentRole | null;
  assistantAccentColor: string | undefined;
  systemPromptBody: string;
  showSharedHeader: boolean;
  isReasoningMessage: boolean;
  isAssistantMessage: boolean;
  isUserMessage: boolean;
  isQueuedUserMessage: boolean;
  isToolMessage: boolean;
  isWorkflowToolMessage: boolean;
  isRegularToolMessage: boolean;
  isSubtaskMessage: boolean;
  isSessionNoticeMessage: boolean;
  isSystemPromptMessage: boolean;
  isRichCardMessage: boolean;
  articleClassName: string;
  articleStyle: CSSProperties | undefined;
};

const resolveAssistantAgentColor = (
  message: AgentChatMessage,
  sessionAgentColors: Record<string, string> | undefined,
): string | undefined => {
  if (message.role !== "assistant") {
    return undefined;
  }
  const assistantMeta = message.meta?.kind === "assistant" ? message.meta : null;
  const agentName = assistantMeta?.profileId;
  if (!agentName) {
    return undefined;
  }
  return resolveAgentAccentColor(agentName, sessionAgentColors?.[agentName]);
};

const resolveUserAgentColor = (
  message: AgentChatMessage,
  sessionAgentColors: Record<string, string> | undefined,
): string | undefined => {
  const messageMeta = message.meta?.kind === "user" ? message.meta : null;
  const agentName = messageMeta?.profileId;
  if (!agentName) {
    return undefined;
  }
  return resolveAgentAccentColor(agentName, sessionAgentColors?.[agentName]);
};

const toArticleClassName = (
  message: AgentChatMessage,
  isReasoningMessage: boolean,
  isUserMessage: boolean,
  isQueuedUserMessage: boolean,
  isToolMessage: boolean,
  isWorkflowToolMessage: boolean,
  isSubtaskMessage: boolean,
  isSessionNoticeMessage: boolean,
  isSystemPromptMessage: boolean,
): string => {
  const meta = message.meta;
  const workflowToolPhase =
    isWorkflowToolMessage && meta?.kind === "tool" ? getToolLifecyclePhase(meta) : null;

  if (isReasoningMessage) {
    return "text-sm border-none bg-transparent px-0 py-0 text-muted-foreground";
  }

  if (isSessionNoticeMessage) {
    const sessionNoticeTone = meta?.kind === "session_notice" ? meta.tone : "cancelled";
    return sessionNoticeTone === "error"
      ? "text-sm my-2 rounded-md border border-destructive-border bg-destructive-surface px-3 py-2 text-destructive-surface-foreground"
      : "text-sm my-2 rounded-md border border-cancelled-border bg-cancelled-surface px-3 py-2 text-cancelled-surface-foreground";
  }

  return cn(
    "text-sm",
    isUserMessage &&
      (isQueuedUserMessage
        ? "mb-4 w-full rounded-none border-l-4 border-pending-border bg-card px-4 py-3 text-foreground shadow-md"
        : "mb-4 w-full rounded-none border-l-4 bg-card px-4 py-3 text-foreground shadow-md"),
    isToolMessage
      ? isWorkflowToolMessage
        ? workflowToolPhase === "completed"
          ? "rounded-md border border-success-border bg-success-surface px-3 py-2 my-2 text-success-surface-foreground"
          : workflowToolPhase === "failed"
            ? "rounded-md border border-destructive-border bg-destructive-surface px-3 py-2 my-2 text-destructive-surface-foreground"
            : workflowToolPhase === "cancelled"
              ? "rounded-md border border-cancelled-border bg-cancelled-surface px-3 py-2 my-2 text-cancelled-surface-foreground"
              : workflowToolPhase === "executing"
                ? "rounded-md border border-info-border bg-info-surface px-3 py-2 my-2 text-info-surface-foreground"
                : "rounded-md border border-pending-border bg-pending-surface px-3 py-2 my-2 text-pending-surface-foreground"
        : "border-none bg-transparent px-0 py-0 text-foreground"
      : isSubtaskMessage
        ? "rounded-md border border-warning-border bg-warning-surface px-3 py-2 text-warning-surface-foreground"
        : isSystemPromptMessage
          ? "rounded-md border border-border bg-muted px-3 py-2 text-foreground"
          : message.role === "assistant"
            ? "px-1 py-1 text-foreground"
            : isUserMessage
              ? ""
              : "border-none bg-transparent px-0 py-0 text-foreground",
  );
};

export const buildAgentChatMessageCardViewModel = ({
  message,
  sessionRole,
  sessionSelectedModel: _sessionSelectedModel,
  sessionAgentColors,
}: AgentChatMessageCardViewModelInput): AgentChatMessageCardViewModel => {
  const timeLabel = formatTime(message.timestamp);
  const meta = message.meta;
  const isReasoningMessage = meta?.kind === "reasoning";
  const isAssistantMessage = message.role === "assistant";
  const isUserMessage = message.role === "user";
  const isQueuedUserMessage = isUserMessage && meta?.kind === "user" && meta.state === "queued";
  const isToolMessage = meta?.kind === "tool";
  const isWorkflowToolMessage = meta?.kind === "tool" && isOdtWorkflowMutationToolName(meta.tool);
  const isRegularToolMessage = isToolMessage && !isWorkflowToolMessage;
  const isSubtaskMessage = meta?.kind === "subtask";
  const isSessionNoticeMessage = meta?.kind === "session_notice";
  const isSystemPromptMessage =
    message.role === "system" && message.content.startsWith(SYSTEM_PROMPT_PREFIX);
  const isRichCardMessage =
    isToolMessage || isSubtaskMessage || isSessionNoticeMessage || isSystemPromptMessage;
  const assistantRole = assistantRoleFromMessage(message, sessionRole);
  const assistantAccentColor = resolveAssistantAgentColor(message, sessionAgentColors);
  const userAccentColor = resolveUserAgentColor(message, sessionAgentColors);
  const systemPromptBody = isSystemPromptMessage
    ? message.content.slice(SYSTEM_PROMPT_PREFIX.length).trimStart()
    : "";
  const showSharedHeader =
    !isUserMessage &&
    !isRegularToolMessage &&
    !isReasoningMessage &&
    !isAssistantMessage &&
    !isSessionNoticeMessage;

  return {
    timeLabel,
    assistantRole,
    assistantAccentColor,
    systemPromptBody,
    showSharedHeader,
    isReasoningMessage,
    isAssistantMessage,
    isUserMessage,
    isQueuedUserMessage,
    isToolMessage,
    isWorkflowToolMessage,
    isRegularToolMessage,
    isSubtaskMessage,
    isSessionNoticeMessage,
    isSystemPromptMessage,
    isRichCardMessage,
    articleClassName: toArticleClassName(
      message,
      isReasoningMessage,
      isUserMessage,
      isQueuedUserMessage,
      isToolMessage,
      isWorkflowToolMessage,
      isSubtaskMessage,
      isSessionNoticeMessage,
      isSystemPromptMessage,
    ),
    articleStyle:
      isUserMessage && !isQueuedUserMessage && userAccentColor
        ? { borderLeftColor: userAccentColor }
        : undefined,
  };
};
