import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

type AgentTranscriptSeparatorProps = {
  label: string;
  className?: string;
};

export function AgentTranscriptSeparator({
  label,
  className,
}: AgentTranscriptSeparatorProps): ReactElement {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-1 pt-8 pb-2 text-xs text-muted-foreground",
        className,
      )}
    >
      <div className="h-px flex-1 bg-border" aria-hidden />
      <span className="shrink-0 font-medium tracking-wide">{label}</span>
      <div className="h-px flex-1 bg-border" aria-hidden />
    </div>
  );
}
