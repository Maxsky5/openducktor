import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { memo, type ReactElement, useContext } from "react";
import { findRuntimeDefinition } from "@/lib/agent-runtime";
import { RuntimeDefinitionsContext } from "@/state/app-state-contexts";
import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import { MessageBody, MessageHeader } from "./agent-chat-message-card-content";
import { buildAgentChatMessageCardViewModel } from "./agent-chat-message-card-view-model";

const EMPTY_SUBAGENT_PENDING_PERMISSION_COUNTS = Object.freeze({}) as Record<string, number>;

type AgentChatMessageCardProps = {
  message: AgentChatMessage;
  isStreamingAssistantMessage?: boolean;
  sessionSelectedModel?: AgentModelSelection | null;
  sessionAgentColors?: Record<string, string>;
  sessionWorkingDirectory?: string | null | undefined;
  sessionRuntimeKind?: RuntimeKind | null | undefined;
  sessionRuntimeId?: string | null | undefined;
  subagentPendingPermissions?: AgentSessionState["pendingPermissions"] | undefined;
  subagentPendingPermissionCount?: number;
  subagentPendingPermissionCountByExternalSessionId?: Record<string, number>;
};

export const AgentChatMessageCard = memo(function AgentChatMessageCard({
  message,
  isStreamingAssistantMessage = false,
  sessionSelectedModel,
  sessionAgentColors,
  sessionWorkingDirectory,
  sessionRuntimeKind,
  sessionRuntimeId,
  subagentPendingPermissions,
  subagentPendingPermissionCount,
  subagentPendingPermissionCountByExternalSessionId = EMPTY_SUBAGENT_PENDING_PERMISSION_COUNTS,
}: AgentChatMessageCardProps): ReactElement | null {
  const runtimeDefinitionsContext = useContext(RuntimeDefinitionsContext);
  const runtimeDefinitions = runtimeDefinitionsContext?.runtimeDefinitions ?? [];
  const workflowToolAliasesByCanonical = sessionRuntimeKind
    ? findRuntimeDefinition(runtimeDefinitions, sessionRuntimeKind)?.workflowToolAliasesByCanonical
    : undefined;
  const vm = buildAgentChatMessageCardViewModel({
    message,
    sessionSelectedModel: sessionSelectedModel ?? null,
    sessionAgentColors,
    workflowToolAliasesByCanonical,
  });
  const resolvedSubagentPendingPermissionCount =
    subagentPendingPermissionCount ??
    (message.meta?.kind === "subagent" && message.meta.externalSessionId
      ? (subagentPendingPermissionCountByExternalSessionId[message.meta.externalSessionId] ?? 0)
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
        subagentPendingPermissions={subagentPendingPermissions}
        subagentPendingPermissionCount={resolvedSubagentPendingPermissionCount}
      />
    </article>
  );
});
