import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import { getToolLifecyclePhase } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model";
import {
  isRegularToolPreparing,
  readRegularToolTiming,
  resolveRegularToolSummary,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-tool-presentation";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
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

const DEFAULT_TOOL_APPEARANCE = {
  text: "text-foreground",
  icon: "text-muted-foreground",
};

const PREPARING_TOOL_APPEARANCE = {
  ...DEFAULT_TOOL_APPEARANCE,
  text: "text-muted-foreground",
};

const TOOL_APPEARANCE = {
  preparing: PREPARING_TOOL_APPEARANCE,
  executing: DEFAULT_TOOL_APPEARANCE,
  completed: DEFAULT_TOOL_APPEARANCE,
  failed: {
    text: "text-destructive-muted",
    icon: "text-destructive-accent",
  },
  cancelled: {
    text: "text-cancelled-muted",
    icon: "text-cancelled-accent",
  },
  queued: PREPARING_TOOL_APPEARANCE,
} satisfies Record<ReturnType<typeof getToolLifecyclePhase>, typeof DEFAULT_TOOL_APPEARANCE>;

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
  const appearance = TOOL_APPEARANCE[lifecyclePhase];
  const summary = resolveRegularToolSummary(meta, messageContent, sessionWorkingDirectory);
  const { isActive, durationMs } = readRegularToolTiming(meta, messageTimestamp);
  const activity = lifecyclePhase === "executing" ? "running" : "preparing";
  return (
    <div
      className={cn(
        "flex min-h-6 items-center gap-2 text-xs",
        isRegularToolPreparing(meta) && "opacity-50",
        hasExpandableDetails ? "cursor-pointer" : "",
        appearance.text,
      )}
    >
      <span className={appearance.icon}>{toolIcon(meta)}</span>
      <p className="shrink-0 font-medium text-current">{displayName}</p>
      {summary.text.length > 0 ? (
        <p
          className={cn(
            "min-w-0 flex-1",
            // The error message of a failed call wraps, so the reader sees all of it.
            summary.isError ? "break-words text-destructive-muted" : "truncate text-foreground/75",
          )}
        >
          {summary.text}
        </p>
      ) : null}
      <ToolMessageTiming
        activity={isActive ? activity : null}
        durationMs={durationMs}
        timeLabel={timeLabel}
        className="text-foreground/75"
      />
    </div>
  );
};
