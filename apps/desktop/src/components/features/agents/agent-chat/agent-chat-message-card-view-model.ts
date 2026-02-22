import { cn } from "@/lib/utils";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import {
  type AgentModelSelection,
  type AgentRole,
  isOdtWorkflowMutationToolName,
} from "@openducktor/core";
import { resolveAgentAccentColor } from "../agent-accent-color";
import {
  SYSTEM_PROMPT_PREFIX,
  assistantRoleFromMessage,
  formatTime,
} from "./agent-chat-message-card-model";
import { isToolMessageFailure } from "./agent-chat-message-card-tool-presenters";

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
  isUserMessage: boolean;
  isToolMessage: boolean;
  isWorkflowToolMessage: boolean;
  isRegularToolMessage: boolean;
  isSubtaskMessage: boolean;
  isSystemPromptMessage: boolean;
  isRichCardMessage: boolean;
  articleClassName: string;
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

const toArticleClassName = (
  message: AgentChatMessage,
  isUserMessage: boolean,
  isToolMessage: boolean,
  isWorkflowToolMessage: boolean,
  isSubtaskMessage: boolean,
  isSystemPromptMessage: boolean,
): string => {
  const meta = message.meta;
  const workflowToolFailed =
    isWorkflowToolMessage && meta?.kind === "tool" ? isToolMessageFailure(meta) : false;
  const workflowToolCompleted =
    isWorkflowToolMessage && meta?.kind === "tool"
      ? meta.status === "completed" && !workflowToolFailed
      : false;

  return cn(
    "text-sm",
    isUserMessage &&
      "ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm border border-sky-100 bg-sky-50 px-4 py-3 text-slate-900 shadow-sm",
    isToolMessage
      ? isWorkflowToolMessage
        ? workflowToolCompleted
          ? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900"
          : workflowToolFailed
            ? "rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-900"
            : "rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900"
        : "border-none bg-transparent px-0 py-0 text-slate-800"
      : isSubtaskMessage
        ? "rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900"
        : isSystemPromptMessage
          ? "rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-800"
          : message.role === "assistant"
            ? "border-l-2 border-slate-200 pl-3 pr-1 py-1 text-slate-800"
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
  const systemPromptBody = isSystemPromptMessage
    ? message.content.slice(SYSTEM_PROMPT_PREFIX.length).trimStart()
    : "";

  return {
    timeLabel,
    assistantRole,
    assistantAccentColor,
    systemPromptBody,
    isReasoningMessage,
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
  };
};
