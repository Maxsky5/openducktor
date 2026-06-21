import { memo, type ReactElement, use } from "react";
import { findRuntimeDefinition } from "@/lib/agent-runtime";
import { RuntimeDefinitionsContext } from "@/state/app-state-contexts";
import type { AgentChatMessage, AgentSessionIdentity } from "@/types/agent-orchestrator";
import { MessageBody, MessageHeader } from "./agent-chat-message-card-content";
import { buildAgentChatMessageCardViewModel } from "./agent-chat-message-card-view-model";

type AgentChatMessageCardProps = {
  message: AgentChatMessage;
  isStreamingAssistantMessage?: boolean;
  sessionAgentColors?: Record<string, string>;
  sessionIdentity: AgentSessionIdentity | null;
  subagentPendingApprovalCount?: number;
  subagentPendingQuestionCount?: number;
};

export const AgentChatMessageCard = memo(function AgentChatMessageCard({
  message,
  isStreamingAssistantMessage = false,
  sessionAgentColors,
  sessionIdentity,
  subagentPendingApprovalCount = 0,
  subagentPendingQuestionCount = 0,
}: AgentChatMessageCardProps): ReactElement | null {
  const runtimeDefinitionsContext = use(RuntimeDefinitionsContext);
  const runtimeDefinitions = runtimeDefinitionsContext?.runtimeDefinitions ?? [];
  const sessionRuntimeKind = sessionIdentity?.runtimeKind ?? null;
  const sessionWorkingDirectory = sessionIdentity?.workingDirectory ?? null;
  const workflowToolAliasesByCanonical = sessionRuntimeKind
    ? findRuntimeDefinition(runtimeDefinitions, sessionRuntimeKind)?.workflowToolAliasesByCanonical
    : undefined;
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
