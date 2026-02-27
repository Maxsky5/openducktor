import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import { formatAgentDuration } from "./format-agent-duration";

type AgentTurnDurationSeparatorProps = {
  durationMs: number;
  className?: string;
};

export function AgentTurnDurationSeparator({
  durationMs,
  className,
}: AgentTurnDurationSeparatorProps): ReactElement {
  return (
    <div className={cn("flex items-center gap-3 px-1 py-1 text-xs text-muted-foreground", className)}>
      <div className="h-px flex-1 bg-secondary" aria-hidden />
      <span className="shrink-0 font-medium tracking-wide">
        Worked for {formatAgentDuration(durationMs)}
      </span>
      <div className="h-px flex-1 bg-secondary" aria-hidden />
    </div>
  );
}
