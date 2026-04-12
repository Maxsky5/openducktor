import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import { memo, type ReactElement } from "react";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import { MessageBody, MessageHeader } from "./agent-chat-message-card-content";
import { buildAgentChatMessageCardViewModel } from "./agent-chat-message-card-view-model";

type AgentChatMessageCardProps = {
  message: AgentChatMessage;
  isStreamingAssistantMessage?: boolean;
  sessionRole: AgentRole | null;
  sessionSelectedModel?: AgentModelSelection | null;
  sessionAgentColors?: Record<string, string>;
  sessionWorkingDirectory?: string | null | undefined;
};

export const AgentChatMessageCard = memo(function AgentChatMessageCard({
  message,
  isStreamingAssistantMessage = false,
  sessionRole,
  sessionSelectedModel,
  sessionAgentColors,
  sessionWorkingDirectory,
}: AgentChatMessageCardProps): ReactElement | null {
  const vm = buildAgentChatMessageCardViewModel({
    message,
    sessionRole,
    sessionSelectedModel: sessionSelectedModel ?? null,
    sessionAgentColors,
  });

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
        assistantAccentColor={vm.assistantAccentColor}
        isStreamingAssistantMessage={isStreamingAssistantMessage}
        timeLabel={vm.timeLabel}
        systemPromptBody={vm.systemPromptBody}
        sessionWorkingDirectory={sessionWorkingDirectory}
      />
    </article>
  );
});
