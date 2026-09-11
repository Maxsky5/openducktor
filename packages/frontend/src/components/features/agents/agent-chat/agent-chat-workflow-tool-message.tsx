import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import {
  getToolDuration,
  getToolLifecyclePhase,
  hasNonEmptyInput,
  hasNonEmptyText,
} from "./agent-chat-message-card-model";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { toolIcon } from "./agent-chat-tool-icon";
import { ToolInputDetails } from "./agent-chat-tool-input-details";
import { ToolJsonDetails } from "./agent-chat-tool-json-details";
import { ToolMessageTiming } from "./agent-chat-tool-message-timing";

const WORKFLOW_TOOL_APPEARANCE = {
  queued: {
    label: "QUEUED",
    statusClassName: "border-pending-border bg-pending-surface text-pending-surface-foreground",
    foregroundClassName: "text-pending-surface-foreground",
  },
  executing: {
    label: "RUNNING",
    statusClassName: "border-info-border bg-info-surface text-info-surface-foreground",
    foregroundClassName: "text-info-surface-foreground",
  },
  failed: {
    label: "FAILED",
    statusClassName:
      "border-destructive-border bg-destructive-surface text-destructive-surface-foreground",
    foregroundClassName: "text-destructive-surface-foreground",
  },
  cancelled: {
    label: "CANCELLED",
    statusClassName:
      "border-cancelled-border bg-cancelled-surface text-cancelled-surface-foreground",
    foregroundClassName: "text-cancelled-surface-foreground",
  },
  completed: {
    label: null,
    statusClassName: "border-pending-border bg-pending-surface text-pending-surface-foreground",
    foregroundClassName: "text-success-surface-foreground",
  },
} satisfies Record<
  ReturnType<typeof getToolLifecyclePhase>,
  {
    label: string | null;
    statusClassName: string;
    foregroundClassName: string;
  }
>;

type WorkflowToolMessageProps = {
  meta: ToolMeta;
  messageTimestamp: string;
  timeLabel: string;
  sessionWorkingDirectory?: string | null | undefined;
  displayName: string;
};

export const WorkflowToolMessage = ({
  meta,
  messageTimestamp,
  timeLabel,
  sessionWorkingDirectory,
  displayName,
}: WorkflowToolMessageProps): ReactElement => {
  const durationMs = getToolDuration(meta, messageTimestamp);
  const hasInput = hasNonEmptyInput(meta.input);
  const hasOutput = hasNonEmptyText(meta.output);
  const hasError = hasNonEmptyText(meta.error);
  const lifecyclePhase = getToolLifecyclePhase(meta);
  const isFailure = lifecyclePhase === "failed";
  const isExecuting = lifecyclePhase === "executing";
  const {
    label: statusLabel,
    statusClassName,
    foregroundClassName,
  } = WORKFLOW_TOOL_APPEARANCE[lifecyclePhase];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={foregroundClassName}>{toolIcon(meta)}</span>
        <p className={cn("text-[11px] font-semibold", foregroundClassName)}>{displayName}</p>
        {statusLabel ? (
          <span
            className={cn(
              "rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              statusClassName,
            )}
          >
            {statusLabel}
          </span>
        ) : null}
        <ToolMessageTiming
          showSpinner={isExecuting}
          durationMs={durationMs}
          timeLabel={timeLabel}
          className="text-current/75 font-normal normal-case"
        />
      </div>
      {(hasInput || hasOutput || hasError) && (
        <div className="space-y-2">
          {hasInput && meta.input ? (
            <ToolInputDetails
              input={meta.input}
              workingDirectory={sessionWorkingDirectory}
              className="rounded border border-current/20 bg-card"
              textClassName="text-current"
            />
          ) : null}
          {hasOutput && meta.output ? (
            <ToolJsonDetails
              label="Output"
              value={meta.output}
              className="rounded border border-current/20 bg-card"
              titleClassName="cursor-pointer px-2 py-1 text-xs font-medium text-current"
            />
          ) : null}
          {hasError && meta.error ? (
            <ToolJsonDetails
              label="Error"
              value={meta.error}
              className="rounded border border-current/20 bg-muted/90"
              titleClassName="cursor-pointer px-2 py-1 text-xs font-medium text-current"
              open={isFailure}
            />
          ) : null}
        </div>
      )}
    </div>
  );
};
