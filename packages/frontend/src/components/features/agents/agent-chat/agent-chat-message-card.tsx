import type { AgentModelCatalog } from "@openducktor/core";
import { memo, type ReactElement } from "react";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import type { AgentChatRuntimePresentation } from "./agent-chat.types";
import { MessageBody, MessageHeader } from "./agent-chat-message-card-content";
import { buildAgentChatMessageCardViewModel } from "./agent-chat-message-card-view-model";
import type { ParentSessionRuntimeContext } from "./subagent-session-key";

type AgentChatMessageCardProps = {
  message: AgentChatMessage;
  modelCatalog?: AgentModelCatalog | null;
  isStreamingAssistantMessage?: boolean;
  sessionAgentColors?: Record<string, string>;
  sessionIdentity: ParentSessionRuntimeContext | null;
  runtimePresentation: AgentChatRuntimePresentation;
  subagentPendingApprovalCount?: number;
  subagentPendingQuestionCount?: number;
};

export const AgentChatMessageCard = memo(function AgentChatMessageCard({
  message,
  modelCatalog = null,
  isStreamingAssistantMessage = false,
  sessionAgentColors,
  sessionIdentity,
  runtimePresentation,
  subagentPendingApprovalCount = 0,
  subagentPendingQuestionCount = 0,
}: AgentChatMessageCardProps): ReactElement | null {
  const sessionRuntimeKind = runtimePresentation.runtimeKind;
  const sessionWorkingDirectory = sessionIdentity?.workingDirectory ?? null;
  const toolCallPresentation =
    message.meta?.kind === "tool"
      ? runtimePresentation.presentToolCall(message.meta.tool, message.meta.displayLabel)
      : null;
  const vm = buildAgentChatMessageCardViewModel({
    message,
    sessionAgentColors,
    sessionRuntimeKind: sessionRuntimeKind ?? null,
    toolCallPresentation,
  });
  const isSessionError =
    message.meta?.kind === "session_notice" && message.meta.reason === "session_error";
  return (
    <article
      className={vm.articleClassName}
      style={vm.articleStyle}
      {...(isSessionError ? { "data-notification-attention-kind": "error", tabIndex: -1 } : {})}
    >
      <MessageHeader
        message={message}
        timeLabel={vm.timeLabel}
        showHeader={vm.showSharedHeader}
        assistantRole={vm.assistantRole}
        compactPadding={vm.isRichCardMessage && !vm.isRegularToolMessage}
      />
      <MessageBody
        message={message}
        modelCatalog={modelCatalog}
        parentSession={sessionIdentity}
        assistantAccentColor={vm.assistantAccentColor}
        isStreamingAssistantMessage={isStreamingAssistantMessage}
        timeLabel={vm.timeLabel}
        systemPromptBody={vm.systemPromptBody}
        sessionWorkingDirectory={sessionWorkingDirectory}
        toolCallPresentation={toolCallPresentation}
        subagentPendingApprovalCount={subagentPendingApprovalCount}
        subagentPendingQuestionCount={subagentPendingQuestionCount}
      />
    </article>
  );
});
