import type { AgentChatMessage } from "@/types/agent-orchestrator";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import type { ReactElement } from "react";
import { MessageBody, MessageHeader } from "./agent-chat-message-card-content";
import { buildAgentChatMessageCardViewModel } from "./agent-chat-message-card-view-model";

type AgentChatMessageCardProps = {
  message: AgentChatMessage;
  sessionRole: AgentRole | null;
  sessionSelectedModel: AgentModelSelection | null;
  sessionAgentColors?: Record<string, string>;
};

export function AgentChatMessageCard({
  message,
  sessionRole,
  sessionSelectedModel,
  sessionAgentColors,
}: AgentChatMessageCardProps): ReactElement | null {
  const vm = buildAgentChatMessageCardViewModel({
    message,
    sessionRole,
    sessionSelectedModel,
    sessionAgentColors,
  });

  return (
    <article className={vm.articleClassName}>
      <MessageHeader
        message={message}
        sessionRole={sessionRole}
        timeLabel={vm.timeLabel}
        showHeader={!vm.isUserMessage && !vm.isRegularToolMessage && !vm.isReasoningMessage}
        assistantRole={vm.assistantRole}
        compactPadding={vm.isRichCardMessage && !vm.isRegularToolMessage}
      />
      <MessageBody
        message={message}
        sessionSelectedModel={sessionSelectedModel}
        assistantAccentColor={vm.assistantAccentColor}
        timeLabel={vm.timeLabel}
        systemPromptBody={vm.systemPromptBody}
      />
    </article>
  );
}
