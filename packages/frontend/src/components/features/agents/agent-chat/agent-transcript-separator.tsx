import type { ReactElement, ReactNode } from "react";
import { cn } from "@/lib/utils";

type AgentTranscriptSeparatorProps = {
  label: ReactNode;
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
      <div className="h-px min-w-0.5 flex-1 bg-border" aria-hidden />
      <span className="min-w-0 text-center font-medium tracking-wide">{label}</span>
      <div className="h-px min-w-0.5 flex-1 bg-border" aria-hidden />
    </div>
  );
}
