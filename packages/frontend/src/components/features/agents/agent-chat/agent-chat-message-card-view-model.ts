import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import { type AgentRole, isOdtWorkflowMutationToolName } from "@openducktor/core";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import { resolveAgentSessionAccentColor } from "../agent-accent-color";
import {
  assistantRoleFromMessage,
  formatTime,
  getToolLifecyclePhase,
  SYSTEM_PROMPT_PREFIX,
} from "./agent-chat-message-card-model";

const SESSION_NOTICE_TONE_CLASS_NAMES = {
  cancelled:
    "text-sm my-2 rounded-md border border-cancelled-border bg-cancelled-surface px-3 py-2 text-cancelled-surface-foreground",
  error:
    "text-sm my-2 rounded-md border border-destructive-border bg-destructive-surface px-3 py-2 text-destructive-surface-foreground",
  info: "text-sm my-2 rounded-md border border-info-border bg-info-surface px-3 py-2 text-info-surface-foreground",
} as const;

type AgentChatMessageCardViewModelInput = {
  message: AgentChatMessage;
  sessionAgentColors: Record<string, string> | undefined;
  sessionRuntimeKind: RuntimeKind | null;
  workflowToolAliasesByCanonical?: RuntimeDescriptor["workflowToolAliasesByCanonical"] | undefined;
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
  isSubagentMessage: boolean;
  isSessionNoticeMessage: boolean;
  isSystemPromptMessage: boolean;
  isRichCardMessage: boolean;
  articleClassName: string;
  articleStyle: CSSProperties | undefined;
};

const resolveMessageAgentColor = (
  profileId: string | null | undefined,
  sessionAgentColors: Record<string, string> | undefined,
  sessionRuntimeKind: RuntimeKind | null,
): string | undefined => {
  return resolveAgentSessionAccentColor({
    agentName: profileId,
    agentColors: sessionAgentColors,
    runtimeKind: sessionRuntimeKind,
  });
};

const toArticleClassName = (
  message: AgentChatMessage,
  isReasoningMessage: boolean,
  isUserMessage: boolean,
  isQueuedUserMessage: boolean,
  isToolMessage: boolean,
  isWorkflowToolMessage: boolean,
  isSubagentMessage: boolean,
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
    return SESSION_NOTICE_TONE_CLASS_NAMES[sessionNoticeTone];
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
      : isSubagentMessage
        ? "rounded-md border border-border bg-card px-3 py-2 text-foreground shadow-sm my-2"
        : isSystemPromptMessage
          ? "rounded-md border border-border bg-muted px-3 py-2 text-foreground"
          : message.role === "assistant"
            ? "px-1 pt-1 pb-3 text-foreground"
            : isUserMessage
              ? ""
              : "border-none bg-transparent px-0 py-2 text-foreground",
  );
};

export const buildAgentChatMessageCardViewModel = ({
  message,
  sessionAgentColors,
  sessionRuntimeKind,
  workflowToolAliasesByCanonical,
}: AgentChatMessageCardViewModelInput): AgentChatMessageCardViewModel => {
  const timeLabel = message.timestampIsApproximate ? "" : formatTime(message.timestamp);
  const meta = message.meta;
  const isReasoningMessage = meta?.kind === "reasoning";
  const isAssistantMessage = message.role === "assistant";
  const isUserMessage = message.role === "user";
  const isQueuedUserMessage = isUserMessage && meta?.kind === "user" && meta.state === "queued";
  const isToolMessage = meta?.kind === "tool";
  const isWorkflowToolMessage =
    meta?.kind === "tool" &&
    isOdtWorkflowMutationToolName(meta.tool, workflowToolAliasesByCanonical);
  const isRegularToolMessage = isToolMessage && !isWorkflowToolMessage;
  const isSubagentMessage = meta?.kind === "subagent";
  const isSessionNoticeMessage = meta?.kind === "session_notice";
  const isSystemPromptMessage =
    message.role === "system" && message.content.startsWith(SYSTEM_PROMPT_PREFIX);
  const isRichCardMessage =
    isToolMessage || isSubagentMessage || isSessionNoticeMessage || isSystemPromptMessage;
  const assistantRole = assistantRoleFromMessage(message);
  const assistantMeta = meta?.kind === "assistant" ? meta : null;
  const userMeta = meta?.kind === "user" ? meta : null;
  const assistantAccentColor = isAssistantMessage
    ? resolveMessageAgentColor(assistantMeta?.profileId, sessionAgentColors, sessionRuntimeKind)
    : undefined;
  const userAccentColor = isUserMessage
    ? resolveMessageAgentColor(userMeta?.profileId, sessionAgentColors, sessionRuntimeKind)
    : undefined;
  const systemPromptBody = isSystemPromptMessage
    ? message.content.slice(SYSTEM_PROMPT_PREFIX.length).trimStart()
    : "";
  const showSharedHeader =
    !isUserMessage &&
    !isToolMessage &&
    !isReasoningMessage &&
    !isAssistantMessage &&
    !isSessionNoticeMessage &&
    !isSubagentMessage;

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
    isSubagentMessage,
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
      isSubagentMessage,
      isSessionNoticeMessage,
      isSystemPromptMessage,
    ),
    articleStyle:
      isUserMessage && !isQueuedUserMessage && userAccentColor
        ? { borderLeftColor: userAccentColor }
        : undefined,
  };
};
