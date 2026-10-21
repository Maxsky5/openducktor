import { LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import { formatAgentDuration } from "./format-agent-duration";
import "./agent-chat-tool-message-timing.css";

export type ToolMessageActivity = "preparing" | "running" | null;

export const ToolMessageTiming = ({
  activity,
  durationMs,
  timeLabel,
  className,
}: {
  activity: ToolMessageActivity;
  durationMs: number | null;
  timeLabel: string;
  className: string;
}): ReactElement => (
  <span className={cn("ml-auto inline-flex shrink-0 items-center gap-2 text-[11px]", className)}>
    {activity === "preparing" ? (
      <span role="img" aria-label="Preparing tool" className="inline-flex size-3 shrink-0">
        <LoaderCircle
          aria-hidden="true"
          className="size-3 animate-spin motion-reduce:animate-none"
        />
      </span>
    ) : null}
    {activity === "running" ? (
      <span role="img" aria-label="Running tool" className="agent-tool-running">
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </span>
    ) : null}
    {durationMs !== null ? <span>{formatAgentDuration(durationMs)}</span> : null}
    {timeLabel ? <span>{timeLabel}</span> : null}
  </span>
);
