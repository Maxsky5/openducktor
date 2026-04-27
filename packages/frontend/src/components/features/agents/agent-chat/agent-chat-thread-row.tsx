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
  sessionTaskId?: string | null;
  sessionRole: AgentSessionState["role"] | null;
  sessionSelectedModel?: AgentSessionState["selectedModel"] | null;
  sessionWorkingDirectory: AgentSessionState["workingDirectory"] | null;
  sessionRuntimeKind?: AgentSessionState["runtimeKind"] | null | undefined;
  subagentPendingPermissionCountBySessionId?: Record<string, number>;
};

export const AgentChatThreadRow = memo(function AgentChatThreadRow({
  row,
  isStreamingAssistantMessage,
  sessionAgentColors,
  sessionTaskId,
  sessionRole,
  sessionSelectedModel,
  sessionWorkingDirectory,
  sessionRuntimeKind,
  subagentPendingPermissionCountBySessionId = {},
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
            sessionTaskId={sessionTaskId ?? null}
            sessionRole={sessionRole}
            sessionSelectedModel={sessionSelectedModel ?? null}
            sessionAgentColors={sessionAgentColors}
            sessionWorkingDirectory={sessionWorkingDirectory}
            sessionRuntimeKind={sessionRuntimeKind}
            subagentPendingPermissionCountBySessionId={subagentPendingPermissionCountBySessionId}
          />
        </div>
      );
    }
    default:
      return assertNever(row, "Unhandled agent chat row");
  }
});
