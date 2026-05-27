import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { memo, type ReactElement, use } from "react";
import { findRuntimeDefinition } from "@/lib/agent-runtime";
import { RuntimeDefinitionsContext } from "@/state/app-state-contexts";
import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import { MessageBody, MessageHeader } from "./agent-chat-message-card-content";
import { buildAgentChatMessageCardViewModel } from "./agent-chat-message-card-view-model";

const EMPTY_SUBAGENT_PENDING_APPROVAL_COUNTS = Object.freeze({}) as Record<string, number>;
const EMPTY_SUBAGENT_PENDING_QUESTION_COUNTS = Object.freeze({}) as Record<string, number>;

type AgentChatMessageCardProps = {
  message: AgentChatMessage;
  isStreamingAssistantMessage?: boolean;
  sessionSelectedModel?: AgentModelSelection | null;
  sessionAgentColors?: Record<string, string>;
  sessionWorkingDirectory?: string | null | undefined;
  sessionRuntimeKind?: RuntimeKind | null | undefined;
  sessionRuntimeId?: string | null | undefined;
  subagentPendingApprovals?: AgentSessionState["pendingApprovals"] | undefined;
  subagentPendingApprovalCount?: number;
  subagentPendingApprovalCountByExternalSessionId?: Record<string, number>;
  subagentPendingQuestions?: AgentSessionState["pendingQuestions"] | undefined;
  subagentPendingQuestionCount?: number;
  subagentPendingQuestionCountByExternalSessionId?: Record<string, number>;
};

export const AgentChatMessageCard = memo(function AgentChatMessageCard({
  message,
  isStreamingAssistantMessage = false,
  sessionSelectedModel,
  sessionAgentColors,
  sessionWorkingDirectory,
  sessionRuntimeKind,
  sessionRuntimeId,
  subagentPendingApprovals,
  subagentPendingApprovalCount,
  subagentPendingApprovalCountByExternalSessionId = EMPTY_SUBAGENT_PENDING_APPROVAL_COUNTS,
  subagentPendingQuestions,
  subagentPendingQuestionCount,
  subagentPendingQuestionCountByExternalSessionId = EMPTY_SUBAGENT_PENDING_QUESTION_COUNTS,
}: AgentChatMessageCardProps): ReactElement | null {
  const runtimeDefinitionsContext = use(RuntimeDefinitionsContext);
  const runtimeDefinitions = runtimeDefinitionsContext?.runtimeDefinitions ?? [];
  const workflowToolAliasesByCanonical = sessionRuntimeKind
    ? findRuntimeDefinition(runtimeDefinitions, sessionRuntimeKind)?.workflowToolAliasesByCanonical
    : undefined;
  const vm = buildAgentChatMessageCardViewModel({
    message,
    sessionSelectedModel: sessionSelectedModel ?? null,
    sessionAgentColors,
    sessionRuntimeKind: sessionRuntimeKind ?? null,
    workflowToolAliasesByCanonical,
  });
  const resolvedSubagentPendingApprovalCount =
    subagentPendingApprovalCount ??
    (message.meta?.kind === "subagent" && message.meta.externalSessionId
      ? (subagentPendingApprovalCountByExternalSessionId[message.meta.externalSessionId] ?? 0)
      : 0);
  const resolvedSubagentPendingQuestionCount =
    subagentPendingQuestionCount ??
    (message.meta?.kind === "subagent" && message.meta.externalSessionId
      ? (subagentPendingQuestionCountByExternalSessionId[message.meta.externalSessionId] ?? 0)
      : 0);

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
        sessionRuntimeKind={sessionRuntimeKind ?? null}
        sessionRuntimeId={sessionRuntimeId ?? null}
        assistantAccentColor={vm.assistantAccentColor}
        isStreamingAssistantMessage={isStreamingAssistantMessage}
        timeLabel={vm.timeLabel}
        systemPromptBody={vm.systemPromptBody}
        sessionWorkingDirectory={sessionWorkingDirectory}
        workflowToolAliasesByCanonical={workflowToolAliasesByCanonical}
        subagentPendingApprovals={subagentPendingApprovals}
        subagentPendingApprovalCount={resolvedSubagentPendingApprovalCount}
        subagentPendingQuestions={subagentPendingQuestions}
        subagentPendingQuestionCount={resolvedSubagentPendingQuestionCount}
      />
    </article>
  );
});
