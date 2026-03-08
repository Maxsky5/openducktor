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

export type AgentChatMessageCardViewModelInput = {
  message: AgentChatMessage;
  sessionRole: AgentRole | null;
  sessionSelectedModel: AgentModelSelection | null;
  sessionAgentColors: Record<string, string> | undefined;
};

export type AgentChatMessageCardViewModel = {
  timeLabel: string;
  assistantRole: AgentRole | null;
  assistantAccentColor: string | undefined;
  systemPromptBody: string;
  isReasoningMessage: boolean;
  isAssistantMessage: boolean;
  isUserMessage: boolean;
  isToolMessage: boolean;
  isWorkflowToolMessage: boolean;
  isRegularToolMessage: boolean;
  isSubtaskMessage: boolean;
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
  isUserMessage: boolean,
  isToolMessage: boolean,
  isWorkflowToolMessage: boolean,
  isSubtaskMessage: boolean,
  isSystemPromptMessage: boolean,
): string => {
  const meta = message.meta;
  const workflowToolPhase =
    isWorkflowToolMessage && meta?.kind === "tool" ? getToolLifecyclePhase(meta) : null;

  return cn(
    "text-sm",
    isUserMessage &&
      "w-full rounded-none border-l-4 bg-card px-4 py-3 mb-4 text-foreground shadow-md",
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
  sessionSelectedModel,
  sessionAgentColors,
}: AgentChatMessageCardViewModelInput): AgentChatMessageCardViewModel => {
  const timeLabel = formatTime(message.timestamp);
  const meta = message.meta;
  const isReasoningMessage = meta?.kind === "reasoning";
  const isAssistantMessage = message.role === "assistant";
  const isUserMessage = message.role === "user";
  const isToolMessage = meta?.kind === "tool";
  const isWorkflowToolMessage = meta?.kind === "tool" && isOdtWorkflowMutationToolName(meta.tool);
  const isRegularToolMessage = isToolMessage && !isWorkflowToolMessage;
  const isSubtaskMessage = meta?.kind === "subtask";
  const isSystemPromptMessage =
    message.role === "system" && message.content.startsWith(SYSTEM_PROMPT_PREFIX);
  const isRichCardMessage = isToolMessage || isSubtaskMessage || isSystemPromptMessage;
  const assistantRole = assistantRoleFromMessage(message, sessionRole);
  const assistantAccentColor = resolveAssistantAgentColor(message, sessionAgentColors);
  const userAccentColor = resolveUserAgentColor(message, sessionAgentColors);
  const systemPromptBody = isSystemPromptMessage
    ? message.content.slice(SYSTEM_PROMPT_PREFIX.length).trimStart()
    : "";

  return {
    timeLabel,
    assistantRole,
    assistantAccentColor,
    systemPromptBody,
    isReasoningMessage,
    isAssistantMessage,
    isUserMessage,
    isToolMessage,
    isWorkflowToolMessage,
    isRegularToolMessage,
    isSubtaskMessage,
    isSystemPromptMessage,
    isRichCardMessage,
    articleClassName: toArticleClassName(
      message,
      isUserMessage,
      isToolMessage,
      isWorkflowToolMessage,
      isSubtaskMessage,
      isSystemPromptMessage,
    ),
    articleStyle:
      isUserMessage && userAccentColor ? { borderLeftColor: userAccentColor } : undefined,
  };
};
