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
  const workflowToolAliasesByCanonical = runtimePresentation.workflowToolAliasesByCanonical;
  const vm = buildAgentChatMessageCardViewModel({
    message,
    sessionAgentColors,
    sessionRuntimeKind: sessionRuntimeKind ?? null,
    workflowToolAliasesByCanonical,
  });
  return (
    <article className={vm.articleClassName} style={vm.articleStyle}>
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
        workflowToolAliasesByCanonical={workflowToolAliasesByCanonical}
        subagentPendingApprovalCount={subagentPendingApprovalCount}
        subagentPendingQuestionCount={subagentPendingQuestionCount}
      />
    </article>
  );
});
