import { LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import { formatAgentDuration } from "./format-agent-duration";

export const ToolMessageTiming = ({
  showSpinner,
  durationMs,
  timeLabel,
  className,
}: {
  showSpinner: boolean;
  durationMs: number | null;
  timeLabel: string;
  className: string;
}): ReactElement => (
  <span className={cn("ml-auto inline-flex shrink-0 items-center gap-2 text-[11px]", className)}>
    {showSpinner ? <LoaderCircle className="size-3 animate-spin" /> : null}
    {durationMs !== null ? <span>{formatAgentDuration(durationMs)}</span> : null}
    {timeLabel ? <span>{timeLabel}</span> : null}
  </span>
);
