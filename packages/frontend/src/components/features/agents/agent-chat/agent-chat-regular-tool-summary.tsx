import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import {
  buildToolSummary,
  getToolDuration,
  getToolLifecyclePhase,
  isToolMessageActive,
} from "./agent-chat-message-card-model";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { toolIcon } from "./agent-chat-tool-icon";
import { ToolMessageTiming } from "./agent-chat-tool-message-timing";

type RegularToolSummaryProps = {
  meta: ToolMeta;
  messageContent: string;
  messageTimestamp: string;
  timeLabel: string;
  sessionWorkingDirectory?: string | null | undefined;
  displayName: string;
  hasExpandableDetails: boolean;
};

export const RegularToolSummary = ({
  meta,
  messageContent,
  messageTimestamp,
  timeLabel,
  sessionWorkingDirectory,
  displayName,
  hasExpandableDetails,
}: RegularToolSummaryProps): ReactElement => {
  const lifecyclePhase = getToolLifecyclePhase(meta);
  const isActive = isToolMessageActive(meta);
  const summary = buildToolSummary(meta, messageContent, sessionWorkingDirectory);
  const summaryText =
    summary.length > 0
      ? summary
      : lifecyclePhase === "failed"
        ? "Tool failed"
        : lifecyclePhase === "cancelled"
          ? "Tool cancelled"
          : "";
  const durationMs = getToolDuration(meta, messageTimestamp);
  return (
    <div
      className={cn(
        "flex min-h-6 items-center gap-2 text-xs",
        hasExpandableDetails ? "cursor-pointer" : "",
        lifecyclePhase === "failed"
          ? "text-destructive-muted"
          : lifecyclePhase === "cancelled"
            ? "text-cancelled-muted"
            : "text-foreground",
      )}
    >
      <span
        className={cn(
          lifecyclePhase === "failed"
            ? "text-destructive-accent"
            : lifecyclePhase === "cancelled"
              ? "text-cancelled-accent"
              : "text-muted-foreground",
        )}
      >
        {toolIcon(meta)}
      </span>
      <p className="shrink-0 font-medium text-current">{displayName}</p>
      {summaryText.length > 0 ? (
        <p className="truncate text-muted-foreground">{summaryText}</p>
      ) : null}
      <ToolMessageTiming
        showSpinner={isActive}
        durationMs={durationMs}
        timeLabel={timeLabel}
        className="text-muted-foreground"
      />
    </div>
  );
};
