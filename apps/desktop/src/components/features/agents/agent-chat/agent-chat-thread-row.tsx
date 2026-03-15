import type { ReactElement } from "react";
import { assertNever } from "@/lib/assert-never";
import { cn } from "@/lib/utils";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { AgentChatMessageCard } from "./agent-chat-message-card";
import type { AgentChatVirtualRow } from "./agent-chat-thread-virtualization";
import { AgentTurnDurationSeparator } from "./agent-turn-duration-separator";

type AgentChatVirtualRowProps = {
  row: AgentChatVirtualRow;
  sessionAgentColors: Record<string, string>;
  sessionRole: AgentSessionState["role"] | null;
  sessionSelectedModel: AgentSessionState["selectedModel"] | null;
  sessionWorkingDirectory: AgentSessionState["workingDirectory"] | null;
};

export function AgentChatThreadRow({
  row,
  sessionAgentColors,
  sessionRole,
  sessionSelectedModel,
  sessionWorkingDirectory,
}: AgentChatVirtualRowProps): ReactElement {
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
            sessionRole={sessionRole}
            sessionSelectedModel={sessionSelectedModel}
            sessionAgentColors={sessionAgentColors}
            sessionWorkingDirectory={sessionWorkingDirectory}
          />
        </div>
      );
    }
    default:
      return assertNever(row, "Unhandled agent chat row");
  }
}
