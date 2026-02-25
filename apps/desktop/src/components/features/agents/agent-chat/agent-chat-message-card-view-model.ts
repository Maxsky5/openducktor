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
  sessionSelectedModel: AgentModelSelection | null,
  sessionAgentColors: Record<string, string> | undefined,
): string | undefined => {
  const agentName = sessionSelectedModel?.opencodeAgent;
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
    isUserMessage && "w-full rounded-none border-l-4 bg-white px-4 py-3 text-slate-900 shadow-md",
    isToolMessage
      ? isWorkflowToolMessage
        ? workflowToolPhase === "completed"
          ? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900"
          : workflowToolPhase === "failed"
            ? "rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-900"
            : workflowToolPhase === "cancelled"
              ? "rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-orange-900"
              : workflowToolPhase === "executing"
                ? "rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-blue-900"
                : "rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-violet-900"
        : "border-none bg-transparent px-0 py-0 text-slate-800"
      : isSubtaskMessage
        ? "rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900"
        : isSystemPromptMessage
          ? "rounded-md border border-slate-200 bg-slate-100 px-3 py-2 text-slate-800"
          : message.role === "assistant"
            ? "px-1 py-1 text-slate-800"
            : isUserMessage
              ? ""
              : "border-none bg-transparent px-0 py-0 text-slate-800",
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
  const userAccentColor = resolveUserAgentColor(sessionSelectedModel, sessionAgentColors);
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
