import type { PullRequestReviewCheck } from "@openducktor/contracts";
import {
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  ExternalLink,
} from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import { checkBadgeVariant, checkLabel } from "./task-execution-ci-presentation";
import { TaskExecutionCiTimestampLine } from "./task-execution-ci-timestamp-line";

const CHECK_ICON_BY_VARIANT = {
  danger: CircleX,
  secondary: CircleDashed,
  success: CircleCheck,
  warning: Clock,
} as const;

const CHECK_TEXT_CLASS_BY_VARIANT = {
  danger: "text-destructive-surface-foreground",
  secondary: "text-muted-foreground",
  success: "text-success-surface-foreground",
  warning: "text-warning-surface-foreground",
} as const;

export function TaskExecutionCiCheckCard({
  check,
}: {
  check: PullRequestReviewCheck;
}): ReactElement {
  const variant = checkBadgeVariant(check);
  const StatusIcon = CHECK_ICON_BY_VARIANT[variant];
  const label = checkLabel(check);

  return (
    <details className="group/check">
      <summary className="grid cursor-pointer list-none grid-cols-[auto_auto_minmax(0,1fr)_auto_auto] items-center gap-2 px-4 py-2 outline-none transition hover:bg-accent/40 focus-visible:bg-accent/50 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open/check:rotate-90" />
        <StatusIcon className={cn("size-4", CHECK_TEXT_CLASS_BY_VARIANT[variant])} />
        <span className="min-w-0 truncate text-sm font-medium text-foreground">{check.name}</span>
        <span
          className={cn(
            "truncate text-xs font-medium capitalize",
            CHECK_TEXT_CLASS_BY_VARIANT[variant],
          )}
        >
          {label}
        </span>
        {check.url ? (
          <a
            href={check.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
            aria-label={`Open ${check.name} check`}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <ExternalLink className="size-3.5" />
          </a>
        ) : (
          <span aria-hidden="true" className="size-6" />
        )}
      </summary>
      <div className="space-y-2 px-4 pb-3 pl-14 text-xs text-muted-foreground">
        <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1">
          {check.workflow ? (
            <>
              <dt>Workflow</dt>
              <dd className="min-w-0 truncate text-foreground">{check.workflow}</dd>
            </>
          ) : null}
          {check.details ? (
            <>
              <dt>Details</dt>
              <dd className="min-w-0 break-words text-foreground">{check.details}</dd>
            </>
          ) : null}
          {check.startedAt ? (
            <>
              <dt>Started</dt>
              <dd>
                <TaskExecutionCiTimestampLine timestamp={check.startedAt} />
              </dd>
            </>
          ) : null}
          {check.completedAt ? (
            <>
              <dt>Completed</dt>
              <dd>
                <TaskExecutionCiTimestampLine timestamp={check.completedAt} />
              </dd>
            </>
          ) : null}
        </dl>
      </div>
    </details>
  );
}
