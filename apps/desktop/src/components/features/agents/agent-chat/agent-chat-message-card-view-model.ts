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
  sessionSelectedModel: AgentModelSelection | null,
  sessionAgentColors: Record<string, string> | undefined,
): string | undefined => {
  if (message.role !== "assistant") {
    return undefined;
  }
  const assistantMeta = message.meta?.kind === "assistant" ? message.meta : null;
  const agentName = assistantMeta?.opencodeAgent ?? sessionSelectedModel?.opencodeAgent;
  if (!agentName) {
    return undefined;
  }
  return resolveAgentAccentColor(agentName, sessionAgentColors?.[agentName]);
};

const resolveUserAgentColor = (
  message: AgentChatMessage,
  sessionSelectedModel: AgentModelSelection | null,
  sessionAgentColors: Record<string, string> | undefined,
): string | undefined => {
  const messageMeta = message.meta?.kind === "user" ? message.meta : null;
  const agentName = messageMeta?.opencodeAgent ?? sessionSelectedModel?.opencodeAgent;
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
          ? "rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-3 py-2 my-2 text-emerald-900 dark:text-emerald-200"
          : workflowToolPhase === "failed"
            ? "rounded-md border border-destructive-border bg-destructive-surface px-3 py-2 my-2 text-destructive-surface-foreground"
            : workflowToolPhase === "cancelled"
              ? "rounded-md border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/50 px-3 py-2 my-2 text-orange-900 dark:text-orange-200"
              : workflowToolPhase === "executing"
                ? "rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 px-3 py-2 my-2 text-blue-900 dark:text-blue-200"
                : "rounded-md border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/50 px-3 py-2 my-2 text-violet-900 dark:text-violet-200"
        : "border-none bg-transparent px-0 py-0 text-foreground"
      : isSubtaskMessage
        ? "rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 px-3 py-2 text-amber-900 dark:text-amber-200"
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
  const assistantAccentColor = resolveAssistantAgentColor(
    message,
    sessionSelectedModel,
    sessionAgentColors,
  );
  const userAccentColor = resolveUserAgentColor(message, sessionSelectedModel, sessionAgentColors);
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
