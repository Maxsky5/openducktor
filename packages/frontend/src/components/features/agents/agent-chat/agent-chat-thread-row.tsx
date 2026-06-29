import { memo, type ReactElement } from "react";
import { assertNever } from "@/lib/assert-never";
import { cn } from "@/lib/utils";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { AgentChatMessageCard } from "./agent-chat-message-card";
import type { AgentChatTranscriptRow } from "./agent-chat-transcript-model";
import { AgentTurnDurationSeparator } from "./agent-turn-duration-separator";

type AgentChatTranscriptRowProps = {
  row: AgentChatTranscriptRow;
  isStreamingAssistantMessage: boolean;
  sessionAgentColors: Record<string, string>;
  sessionIdentity: AgentSessionIdentity | null;
  subagentPendingApprovalCount?: number;
  subagentPendingQuestionCount?: number;
};

export const AgentChatThreadRow = memo(function AgentChatThreadRow({
  row,
  isStreamingAssistantMessage,
  sessionAgentColors,
  sessionIdentity,
  subagentPendingApprovalCount = 0,
  subagentPendingQuestionCount = 0,
}: AgentChatTranscriptRowProps): ReactElement {
  switch (row.kind) {
    case "turn_duration": {
      return <AgentTurnDurationSeparator durationMs={row.durationMs} />;
    }
    case "message": {
      const isUserMessage = row.message.role === "user";
      return (
        <div className={cn("flow-root", isUserMessage ? "pt-4" : undefined)}>
          <AgentChatMessageCard
            message={row.message}
            isStreamingAssistantMessage={isStreamingAssistantMessage}
            sessionAgentColors={sessionAgentColors}
            sessionIdentity={sessionIdentity}
            subagentPendingApprovalCount={subagentPendingApprovalCount}
            subagentPendingQuestionCount={subagentPendingQuestionCount}
          />
        </div>
      );
    }
    default:
      return assertNever(row, "Unhandled agent chat row");
  }
});
