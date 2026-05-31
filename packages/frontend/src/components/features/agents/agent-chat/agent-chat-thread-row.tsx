import { memo, type ReactElement } from "react";
import { assertNever } from "@/lib/assert-never";
import { cn } from "@/lib/utils";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { AgentChatMessageCard } from "./agent-chat-message-card";
import type { AgentChatWindowRow } from "./agent-chat-thread-windowing";
import { AgentTurnDurationSeparator } from "./agent-turn-duration-separator";

type AgentChatWindowRowProps = {
  row: AgentChatWindowRow;
  isStreamingAssistantMessage: boolean;
  sessionAgentColors: Record<string, string>;
  sessionWorkingDirectory: AgentSessionState["workingDirectory"] | null;
  sessionRuntimeKind?: AgentSessionState["runtimeKind"] | null | undefined;
  sessionRuntimeId?: AgentSessionState["runtimeId"] | null | undefined;
  expandFileDiffsByDefault: boolean;
  subagentPendingApprovals?: AgentSessionState["pendingApprovals"] | undefined;
  subagentPendingApprovalCount?: number;
  subagentPendingQuestions?: AgentSessionState["pendingQuestions"] | undefined;
  subagentPendingQuestionCount?: number;
};

export const AgentChatThreadRow = memo(function AgentChatThreadRow({
  row,
  isStreamingAssistantMessage,
  sessionAgentColors,
  sessionWorkingDirectory,
  sessionRuntimeKind,
  sessionRuntimeId,
  expandFileDiffsByDefault,
  subagentPendingApprovals,
  subagentPendingApprovalCount = 0,
  subagentPendingQuestions,
  subagentPendingQuestionCount = 0,
}: AgentChatWindowRowProps): ReactElement {
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
            sessionWorkingDirectory={sessionWorkingDirectory}
            sessionRuntimeKind={sessionRuntimeKind}
            sessionRuntimeId={sessionRuntimeId}
            expandFileDiffsByDefault={expandFileDiffsByDefault}
            subagentPendingApprovals={subagentPendingApprovals}
            subagentPendingApprovalCount={subagentPendingApprovalCount}
            subagentPendingQuestions={subagentPendingQuestions}
            subagentPendingQuestionCount={subagentPendingQuestionCount}
          />
        </div>
      );
    }
    default:
      return assertNever(row, "Unhandled agent chat row");
  }
});
