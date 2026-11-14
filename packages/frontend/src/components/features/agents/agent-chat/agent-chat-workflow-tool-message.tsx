import type { OdtToolName } from "@openducktor/contracts";
import type { ReactElement, ReactNode } from "react";
import { TaskPullRequestLink } from "@/components/features/task-pull-request-link";
import { cn } from "@/lib/utils";
import {
  getToolDuration,
  getToolLifecyclePhase,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model";
import {
  readWorkflowToolCard,
  workflowToolStatusLabel,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-tool-presentation";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import type { ToolCallError } from "@openducktor/frontend-core/sessions/messages/tool-call-error";
import { toolIcon } from "./agent-chat-tool-icon";
import { useToolDetailsRow } from "./agent-chat-tool-details-store";
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
  /** The message of the call. A press on the card shows it in the tool details. */
  messageId: string;
  /** The ODT tool of the call, as `presentToolCall` resolved it. */
  odtTool?: OdtToolName | null;
  messageTimestamp: string;
  timeLabel: string;
  displayName: string;
  summary?: string;
  icon?: ReactNode;
  action?: ReactNode;
};

// The title covers the card, so a press anywhere on the card shows the call in the tool details.
// The card has `px-3 py-2`, so the press area reaches its border.
const CARD_PRESS_CLASS_NAME =
  "cursor-pointer text-left outline-none after:absolute after:-inset-x-3 after:-inset-y-2 after:rounded-[5px] after:content-[''] hover:after:bg-current/[0.05] focus-visible:after:ring-2 focus-visible:after:ring-ring";
const CARD_SHOWN_CLASS_NAME = "after:bg-current/[0.08] after:ring-1 after:ring-current/25";

/**
 * A workflow tool call: a header with the title, the pull request of the call, its status, and
 * its timing; then its summary, or the error message of a failed call. A workflow event call
 * takes its event as the title. A press on the card shows the call in the tool details, as for
 * the other tool calls, with the note of a workflow event.
 */
export const WorkflowToolMessage = ({
  meta,
  messageId,
  odtTool = null,
  messageTimestamp,
  timeLabel,
  displayName,
  summary,
  icon,
  action,
}: WorkflowToolMessageProps): ReactElement => {
  const details = useToolDetailsRow(messageId);
  const lifecyclePhase = getToolLifecyclePhase(meta);
  const statusLabel = workflowToolStatusLabel(lifecyclePhase);
  const { activity, statusClassName, foregroundClassName } =
    WORKFLOW_TOOL_APPEARANCE[lifecyclePhase];
  const card = readWorkflowToolCard({ meta, odtTool, displayName });
  const titleClassName = cn("min-w-0 break-words text-[11px] font-semibold", foregroundClassName);

  return (
    <div className="relative flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <div className="flex min-w-0 max-w-full flex-auto flex-wrap items-center gap-2">
          <span aria-hidden="true" className={cn("shrink-0", foregroundClassName)}>
            {icon ?? toolIcon(meta, card.iconKind)}
          </span>
          {details ? (
            <button
              type="button"
              aria-pressed={details.isShown}
              className={cn(
                titleClassName,
                CARD_PRESS_CLASS_NAME,
                details.isShown && CARD_SHOWN_CLASS_NAME,
              )}
              onClick={details.onClick}
            >
              {card.title}
            </button>
          ) : (
            <p className={titleClassName}>{card.title}</p>
          )}
          {card.pullRequest ? (
            <TaskPullRequestLink pullRequest={card.pullRequest} className="relative py-0.5" />
          ) : null}
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
            durationMs={getToolDuration(meta, messageTimestamp)}
            timeLabel={timeLabel}
            className="text-current/75 font-normal normal-case"
          />
          {/* The controls of the card stay above the press area of the card. */}
          {action ? <div className="relative flex items-center gap-2">{action}</div> : null}
        </div>
      </div>
      <WorkflowToolLine error={card.error} summary={summary} />
    </div>
  );
};

/** The line under the header: the error message of a failed call, or else the summary. */
const WorkflowToolLine = ({
  error,
  summary,
}: {
  error: ToolCallError | null;
  summary: string | undefined;
}): ReactElement | null => {
  if (error) {
    return (
      <p className="min-w-0 break-words text-[11px] font-medium text-destructive-surface-foreground">
        {error.message}
      </p>
    );
  }
  if (!summary) return null;
  return <p className="min-w-0 break-words text-[11px] text-current/75">{summary}</p>;
};
