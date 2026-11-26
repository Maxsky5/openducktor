import { ChevronDown } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

export function StartupStepCounter({
  completed,
  total,
  className,
}: {
  completed: number;
  total: number;
  className?: string;
}): ReactElement {
  return (
    <span className={cn("text-xs font-normal text-muted-foreground tabular-nums", className)}>
      {completed}/{total}
      <span className="sr-only"> steps complete</span>
    </span>
  );
}

export function StartupExpandChevron({ expanded }: { expanded: boolean }): ReactElement {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground transition-colors group-hover/startup-toggle:text-foreground">
      <ChevronDown
        aria-hidden="true"
        className={cn(
          "size-3.5 transition-transform duration-150 motion-reduce:transition-none",
          expanded && "rotate-180",
        )}
      />
    </span>
  );
}
