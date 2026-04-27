import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import { memo, type ReactElement, useContext } from "react";
import { findRuntimeDefinition } from "@/lib/agent-runtime";
import { RuntimeDefinitionsContext } from "@/state/app-state-contexts";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import { MessageBody, MessageHeader } from "./agent-chat-message-card-content";
import { buildAgentChatMessageCardViewModel } from "./agent-chat-message-card-view-model";

type AgentChatMessageCardProps = {
  message: AgentChatMessage;
  isStreamingAssistantMessage?: boolean;
  sessionTaskId?: string | null;
  sessionRole: AgentRole | null;
  sessionSelectedModel?: AgentModelSelection | null;
  sessionAgentColors?: Record<string, string>;
  sessionWorkingDirectory?: string | null | undefined;
  sessionRuntimeKind?: RuntimeKind | null | undefined;
  subagentPendingPermissionCount?: number;
  subagentPendingPermissionCountBySessionId?: Record<string, number>;
};

export const AgentChatMessageCard = memo(function AgentChatMessageCard({
  message,
  isStreamingAssistantMessage = false,
  sessionTaskId,
  sessionRole,
  sessionSelectedModel,
  sessionAgentColors,
  sessionWorkingDirectory,
  sessionRuntimeKind,
  subagentPendingPermissionCount,
  subagentPendingPermissionCountBySessionId = {},
}: AgentChatMessageCardProps): ReactElement | null {
  const runtimeDefinitionsContext = useContext(RuntimeDefinitionsContext);
  const runtimeDefinitions = runtimeDefinitionsContext?.runtimeDefinitions ?? [];
  const workflowToolAliasesByCanonical = sessionRuntimeKind
    ? findRuntimeDefinition(runtimeDefinitions, sessionRuntimeKind)?.workflowToolAliasesByCanonical
    : undefined;
  const vm = buildAgentChatMessageCardViewModel({
    message,
    sessionRole,
    sessionSelectedModel: sessionSelectedModel ?? null,
    sessionAgentColors,
    workflowToolAliasesByCanonical,
  });
  const resolvedSubagentPendingPermissionCount =
    subagentPendingPermissionCount ??
    (message.meta?.kind === "subagent" && message.meta.sessionId
      ? (subagentPendingPermissionCountBySessionId[message.meta.sessionId] ?? 0)
      : 0);

  return (
    <article className={vm.articleClassName} style={vm.articleStyle}>
      <MessageHeader
        message={message}
        sessionRole={sessionRole}
        timeLabel={vm.timeLabel}
        showHeader={vm.showSharedHeader}
        assistantRole={vm.assistantRole}
        compactPadding={vm.isRichCardMessage && !vm.isRegularToolMessage}
      />
      <MessageBody
        message={message}
        sessionTaskId={sessionTaskId ?? null}
        sessionRole={sessionRole}
        sessionRuntimeKind={sessionRuntimeKind ?? null}
        assistantAccentColor={vm.assistantAccentColor}
        isStreamingAssistantMessage={isStreamingAssistantMessage}
        timeLabel={vm.timeLabel}
        systemPromptBody={vm.systemPromptBody}
        sessionWorkingDirectory={sessionWorkingDirectory}
        workflowToolAliasesByCanonical={workflowToolAliasesByCanonical}
        subagentPendingPermissionCount={resolvedSubagentPendingPermissionCount}
      />
    </article>
  );
});
