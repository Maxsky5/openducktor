import type { OdtToolName } from "@openducktor/contracts";
import { ChevronDown } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { TaskPullRequestLink } from "@/components/features/task-pull-request-link";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  getToolDuration,
  getToolLifecyclePhase,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model";
import {
  readWorkflowToolCard,
  type WorkflowToolCard,
  workflowToolStatusLabel,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-tool-presentation";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import type { ToolCallError } from "@openducktor/frontend-core/sessions/messages/tool-call-error";
import { AgentChatMarkdownRenderer } from "./agent-chat-markdown-renderer";
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
  /** The ODT tool of the call, as `presentToolCall` resolved it. */
  odtTool?: OdtToolName | null;
  messageTimestamp: string;
  timeLabel: string;
  sessionWorkingDirectory?: string | null | undefined;
  displayName: string;
  summary?: string;
  icon?: ReactNode;
  action?: ReactNode;
};

/**
 * A workflow tool call: a header with the title, the pull request of the call, its status, and
 * its timing; then its summary, or the error message of a failed call. A workflow event call
 * takes its event as the title. A press on the title shows the note of the event as Markdown,
 * then the Input, Output, and Error boxes, all closed.
 */
export const WorkflowToolMessage = ({
  meta,
  odtTool = null,
  messageTimestamp,
  timeLabel,
  sessionWorkingDirectory,
  displayName,
  summary,
  icon,
  action,
}: WorkflowToolMessageProps): ReactElement => {
  const lifecyclePhase = getToolLifecyclePhase(meta);
  const statusLabel = workflowToolStatusLabel(lifecyclePhase);
  const { activity, statusClassName, foregroundClassName } =
    WORKFLOW_TOOL_APPEARANCE[lifecyclePhase];
  const card = readWorkflowToolCard({ meta, odtTool, displayName, opensDocument: false });
  const { title, hasDetails } = card;
  const titleClassName = cn("min-w-0 break-words text-[11px] font-semibold", foregroundClassName);

  return (
    <Collapsible className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <div className="flex min-w-0 max-w-full flex-auto flex-wrap items-center gap-2">
          <span aria-hidden="true" className={cn("shrink-0", foregroundClassName)}>
            {icon ?? toolIcon(meta, card.iconKind)}
          </span>
          {hasDetails ? (
            // A card with details shows them with a press on its title.
            <CollapsibleTrigger asChild>
              <button
                type="button"
                aria-label={`${title} details`}
                className={cn(
                  "group inline-flex min-w-0 cursor-pointer items-center gap-1 rounded-sm text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring",
                  titleClassName,
                )}
              >
                <span className="min-w-0 break-words">{title}</span>
                <ChevronDown
                  aria-hidden="true"
                  className="size-3 shrink-0 transition-transform motion-reduce:transition-none group-data-[state=open]:rotate-180"
                />
              </button>
            </CollapsibleTrigger>
          ) : (
            <p className={titleClassName}>{title}</p>
          )}
          {card.pullRequest ? (
            <TaskPullRequestLink pullRequest={card.pullRequest} className="py-0.5" />
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
          {action}
        </div>
      </div>
      <WorkflowToolLine error={card.error} summary={summary} />
      {hasDetails ? (
        <CollapsibleContent className="space-y-2">
          <WorkflowToolDetailBoxes
            meta={meta}
            sessionWorkingDirectory={sessionWorkingDirectory}
            card={card}
          />
        </CollapsibleContent>
      ) : null}
    </Collapsible>
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

/**
 * The details of an open card: the event note as Markdown, then the Input, Output, and Error
 * boxes, all closed.
 */
const WorkflowToolDetailBoxes = ({
  meta,
  sessionWorkingDirectory,
  card: { note, showsInput, showsOutput, errorDetail },
}: {
  meta: ToolMeta;
  sessionWorkingDirectory?: string | null | undefined;
  card: WorkflowToolCard;
}): ReactElement => (
  <>
    {note ? <AgentChatMarkdownRenderer markdown={note} variant="compact" /> : null}
    {showsInput ? (
      <ToolInputDetails
        meta={meta}
        workingDirectory={sessionWorkingDirectory}
        className="rounded border border-current/20 bg-card"
        textClassName="text-current"
      />
    ) : null}
    {showsOutput ? (
      <ToolOutputDetails
        meta={meta}
        className="rounded border border-current/20 bg-card"
        summaryClassName="cursor-pointer px-2 py-1 text-xs font-medium text-current"
        bodyClassName="space-y-2 px-2 pb-2 text-[11px]"
      />
    ) : null}
    {errorDetail ? (
      <ToolJsonDetails
        label="Error"
        value={errorDetail}
        className="rounded border border-current/20 bg-muted/90"
        titleClassName="cursor-pointer px-2 py-1 text-xs font-medium text-current"
      />
    ) : null}
  </>
);
