import { LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import { formatAgentDuration } from "@openducktor/frontend-core/sessions/transcript/format-agent-duration";
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
    {activity === "running" ? <ToolRunningBars label="Running tool" /> : null}
    {durationMs !== null ? <span>{formatAgentDuration(durationMs)}</span> : null}
    {timeLabel ? <span>{timeLabel}</span> : null}
  </span>
);

/**
 * The moving bars of a running tool call. With a label, screen readers read it. Without one, the
 * bars sit next to a label and screen readers skip them.
 */
export const ToolRunningBars = ({ label }: { label?: string }): ReactElement => (
  <span
    {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    className="agent-tool-running"
  >
    <span aria-hidden="true" />
    <span aria-hidden="true" />
    <span aria-hidden="true" />
  </span>
);
