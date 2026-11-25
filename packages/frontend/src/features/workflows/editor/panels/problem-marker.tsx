import { AlertTriangle, CircleAlert } from "lucide-react";
import type { ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ProblemLevel } from "../model/canvas-graph";

const MARKERS = {
  error: { Icon: CircleAlert, className: "text-destructive-muted", noun: "problem" },
  warning: { Icon: AlertTriangle, className: "text-warning-muted", noun: "warning" },
} as const;

/** The marker of an element with a problem. Errors and warnings look different. */
export function ProblemMarker({
  level,
  count,
  className,
  title,
}: {
  level: ProblemLevel | null;
  count?: number;
  className?: string;
  /** The problem in words, shown on hover. */
  title?: string | undefined;
}): ReactElement | null {
  if (level === null) return null;
  const { Icon, className: tone, noun } = MARKERS[level];
  const label = count === undefined ? `Has a ${noun}` : `${count} ${noun}${count === 1 ? "" : "s"}`;
  const icon = (
    <Icon role="img" aria-label={label} className={cn("size-3.5 shrink-0", tone, className)} />
  );
  if (!title) return icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex shrink-0">{icon}</span>
      </TooltipTrigger>
      {/* At the side, so it covers neither the box nor the marks in its corner. */}
      <TooltipContent side="right" sideOffset={16} className="max-w-72 text-pretty">
        {title}
      </TooltipContent>
    </Tooltip>
  );
}
