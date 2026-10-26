import type { RuntimeKind } from "@openducktor/contracts";
import { cn } from "@/lib/utils";
import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";
import { resolveAgentSessionAccentColor } from "../agent-accent-color";
import type { AgentChatToolCallPresentation } from "@openducktor/frontend-core/sessions/send/agent-chat.types";
import { getToolLifecyclePhase } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model";
import {
  type AgentChatMessageKind,
  classifyAgentChatMessage,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-message-kind";

const SESSION_NOTICE_TONE_CLASS_NAMES = {
  cancelled:
    "text-sm my-2 rounded-md border border-cancelled-border bg-cancelled-surface px-3 py-2 text-cancelled-surface-foreground",
  error:
    "text-sm my-2 rounded-md border border-destructive-border bg-destructive-surface px-3 py-2 text-destructive-surface-foreground",
  info: "text-sm my-2 rounded-md border border-info-border bg-info-surface px-3 py-2 text-info-surface-foreground",
  warning:
    "text-sm my-2 rounded-md border border-warning-border bg-warning-surface px-3 py-2 text-warning-surface-foreground",
} as const;

type AgentChatMessageCardViewModelInput = {
  message: AgentChatMessage;
  sessionRuntimeKind: RuntimeKind | null;
  toolCallPresentation: AgentChatToolCallPresentation | null;
};

type AgentChatMessageCardViewModel = AgentChatMessageKind & {
  assistantAccentColor: string | undefined;
  articleClassName: string;
};

const toArticleClassName = (
  message: AgentChatMessage,
  isReasoningMessage: boolean,
  isUserMessage: boolean,
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

  if (isUserMessage) {
    // UserMessage draws the bubble. The article only puts it on the right of the transcript.
    return "text-sm mb-4 ml-auto flex w-fit max-w-[80%] flex-col items-end";
  }

  return cn(
    "text-sm",
    isToolMessage
      ? isWorkflowToolMessage
        ? workflowToolPhase === "completed"
          ? "rounded-md border border-success-border bg-success-surface px-3 py-2 my-2 text-success-surface-foreground"
          : workflowToolPhase === "failed"
            ? "rounded-md border border-destructive-border bg-destructive-surface px-3 py-2 my-2 text-destructive-surface-foreground"
            : workflowToolPhase === "cancelled"
              ? "rounded-md border border-cancelled-border bg-cancelled-surface px-3 py-2 my-2 text-cancelled-surface-foreground"
              : workflowToolPhase === "executing" || workflowToolPhase === "preparing"
                ? "rounded-md border border-info-border bg-info-surface px-3 py-2 my-2 text-info-surface-foreground"
                : "rounded-md border border-pending-border bg-pending-surface px-3 py-2 my-2 text-pending-surface-foreground"
        : "border-none bg-transparent px-0 py-0 text-foreground"
      : isSubagentMessage
        ? "rounded-md border border-border bg-card px-3 py-2 text-foreground shadow-sm my-2"
        : isSystemPromptMessage
          ? "rounded-md text-foreground"
          : message.role === "assistant"
            ? "px-1 pt-1 pb-3 text-foreground"
            : "border-none bg-transparent px-0 py-2 text-foreground",
  );
};

export const buildAgentChatMessageCardViewModel = ({
  message,
  sessionRuntimeKind,
  toolCallPresentation,
}: AgentChatMessageCardViewModelInput): AgentChatMessageCardViewModel => {
  const kind = classifyAgentChatMessage({ message, toolCallPresentation });
  return {
    ...kind,
    assistantAccentColor: kind.isAssistantMessage
      ? resolveAgentSessionAccentColor({ runtimeKind: sessionRuntimeKind })
      : undefined,
    articleClassName: toArticleClassName(
      message,
      kind.isReasoningMessage,
      kind.isUserMessage,
      kind.isToolMessage,
      kind.isWorkflowToolMessage,
      kind.isSubagentMessage,
      kind.isSessionNoticeMessage,
      kind.isSystemPromptMessage,
    ),
  };
};
