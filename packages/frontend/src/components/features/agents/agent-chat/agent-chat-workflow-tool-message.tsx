import { AgentToolResultContentView } from "./agent-tool-result-content";
import { type ReactElement, type ReactNode, useState } from "react";
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
import { FullToolPartDetails } from "./agent-chat-tool-part-details";
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
          {meta.detailsOmitted && (hasInput || hasOutput) ? (
            <CutWorkflowToolDetails
              meta={meta}
              hasInput={hasInput}
              hasOutput={hasOutput}
              sessionWorkingDirectory={sessionWorkingDirectory}
            />
          ) : (
            <WorkflowToolInputOutput
              meta={meta}
              hasInput={hasInput}
              hasOutput={hasOutput}
              sessionWorkingDirectory={sessionWorkingDirectory}
            />
          )}
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

type WorkflowToolInputOutputProps = {
  meta: ToolMeta;
  hasInput: boolean;
  hasOutput: boolean;
  sessionWorkingDirectory?: string | null | undefined;
};

/** The Input and Output boxes of a call. */
const WorkflowToolInputOutput = ({
  meta,
  hasInput,
  hasOutput,
  sessionWorkingDirectory,
}: WorkflowToolInputOutputProps): ReactElement => (
  <>
    {hasInput && meta.input ? (
      <ToolInputDetails
        input={meta.input}
        workingDirectory={sessionWorkingDirectory}
        className="rounded border border-current/20 bg-card"
        textClassName="text-current"
      />
    ) : null}
    {meta.resultContent ? (
      <details className="rounded border border-current/20 bg-card">
        <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-current">
          Output
        </summary>
        <div className="space-y-2 px-2 pb-2">
          <AgentToolResultContentView content={meta.resultContent} />
        </div>
      </details>
    ) : hasOutput && meta.output ? (
      <ToolJsonDetails
        label="Output"
        value={meta.output}
        className="rounded border border-current/20 bg-card"
        titleClassName="cursor-pointer px-2 py-1 text-xs font-medium text-current"
      />
    ) : null}
  </>
);

/**
 * The input and output of a call that compact history cut. Opening the box reads the full call,
 * then shows its Input and Output boxes.
 */
const CutWorkflowToolDetails = (props: WorkflowToolInputOutputProps): ReactElement => {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="rounded border border-current/20 bg-card"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-current">
        Input and output
      </summary>
      {open ? (
        <div className="space-y-2 px-2 pb-2">
          <FullToolPartDetails meta={props.meta}>
            {(full) => <WorkflowToolInputOutput {...props} meta={full} />}
          </FullToolPartDetails>
        </div>
      ) : null}
    </details>
  );
};
