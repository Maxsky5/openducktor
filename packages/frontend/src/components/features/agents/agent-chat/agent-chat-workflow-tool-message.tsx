import type { ReactElement, ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  getToolDuration,
  getToolLifecyclePhase,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model";
import {
  readToolDetailAvailability,
  workflowToolStatusLabel,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-tool-presentation";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import { toolIcon } from "./agent-chat-tool-icon";
import { ToolInputDetails } from "./agent-chat-tool-input-details";
import { ToolJsonDetails } from "./agent-chat-tool-json-details";
import { ToolOutputDetails } from "./agent-chat-tool-output-details";
import { ToolMessageTiming, type ToolMessageActivity } from "./agent-chat-tool-message-timing";

const WORKFLOW_TOOL_APPEARANCE = {
  preparing: {
    activity: "preparing",
    statusClassName: "border-info-border bg-info-surface text-info-surface-foreground",
    foregroundClassName: "text-info-surface-foreground",
  },
  queued: {
    activity: null,
    statusClassName: "border-pending-border bg-pending-surface text-pending-surface-foreground",
    foregroundClassName: "text-pending-surface-foreground",
  },
  executing: {
    activity: "running",
    statusClassName: "border-info-border bg-info-surface text-info-surface-foreground",
    foregroundClassName: "text-info-surface-foreground",
  },
  failed: {
    activity: null,
    statusClassName:
      "border-destructive-border bg-destructive-surface text-destructive-surface-foreground",
    foregroundClassName: "text-destructive-surface-foreground",
  },
  cancelled: {
    activity: null,
    statusClassName:
      "border-cancelled-border bg-cancelled-surface text-cancelled-surface-foreground",
    foregroundClassName: "text-cancelled-surface-foreground",
  },
  completed: {
    activity: null,
    statusClassName: "border-pending-border bg-pending-surface text-pending-surface-foreground",
    foregroundClassName: "text-success-surface-foreground",
  },
} satisfies Record<
  ReturnType<typeof getToolLifecyclePhase>,
  {
    activity: ToolMessageActivity;
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
  summary?: string;
  icon?: ReactNode;
  action?: ReactNode;
};

export const WorkflowToolMessage = ({
  meta,
  messageTimestamp,
  timeLabel,
  sessionWorkingDirectory,
  displayName,
  summary,
  icon,
  action,
}: WorkflowToolMessageProps): ReactElement => {
  const durationMs = getToolDuration(meta, messageTimestamp);
  const { hasInput, hasOutput, hasError } = readToolDetailAvailability(meta);
  const lifecyclePhase = getToolLifecyclePhase(meta);
  const isFailure = lifecyclePhase === "failed";
  const statusLabel = workflowToolStatusLabel(lifecyclePhase);
  const { activity, statusClassName, foregroundClassName } =
    WORKFLOW_TOOL_APPEARANCE[lifecyclePhase];

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <div className="flex min-w-0 max-w-full flex-auto items-center gap-2">
          <span aria-hidden="true" className={cn("shrink-0", foregroundClassName)}>
            {icon ?? toolIcon(meta)}
          </span>
          <p className={cn("min-w-0 break-words text-[11px] font-semibold", foregroundClassName)}>
            {displayName}
          </p>
          {statusLabel ? (
            <span
              className={cn(
                "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                statusClassName,
              )}
            >
              {statusLabel}
            </span>
          ) : null}
        </div>
        <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
          <ToolMessageTiming
            activity={activity}
            durationMs={durationMs}
            timeLabel={timeLabel}
            className="text-current/75 font-normal normal-case"
          />
          {action}
        </div>
      </div>
      {summary ? (
        <p className="min-w-0 break-words text-[11px] text-current/75">{summary}</p>
      ) : null}
      {(hasInput || hasOutput || hasError) && (
        <div className="space-y-2">
          {hasInput && meta.input ? (
            <ToolInputDetails
              meta={meta}
              workingDirectory={sessionWorkingDirectory}
              className="rounded border border-current/20 bg-card"
              textClassName="text-current"
            />
          ) : null}
          {hasOutput ? (
            <ToolOutputDetails
              meta={meta}
              className="rounded border border-current/20 bg-card"
              summaryClassName="cursor-pointer px-2 py-1 text-xs font-medium text-current"
              bodyClassName="space-y-2 px-2 pb-2 text-[11px]"
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
