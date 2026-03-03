import { Brain, LoaderCircle, type LucideIcon } from "lucide-react";
import type { ReactElement } from "react";
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
  streamingRoleIcon: LucideIcon;
  streamingRoleLabel: string;
};

export function AgentChatThreadRow({
  row,
  sessionAgentColors,
  sessionRole,
  sessionSelectedModel,
  streamingRoleIcon,
  streamingRoleLabel,
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
          />
        </div>
      );
    }
    case "draft": {
      const StreamingRoleIcon = streamingRoleIcon;
      return (
        <article className="px-1 py-1 text-sm text-foreground">
          <header className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <StreamingRoleIcon className="size-3" />
            {streamingRoleLabel} (streaming)
            <LoaderCircle className="size-3 animate-spin" />
          </header>
          <p className="whitespace-pre-wrap leading-6 text-foreground">{row.draftText}</p>
        </article>
      );
    }
    case "thinking": {
      return (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-input bg-card px-3 py-2 text-xs text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
          <Brain className="size-3.5 text-pending-accent" />
          Agent is thinking...
        </div>
      );
    }
  }
}
