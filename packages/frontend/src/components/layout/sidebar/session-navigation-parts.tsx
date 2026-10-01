import { Check, CircleAlert, RotateCcw, TriangleAlert } from "lucide-react";
import type { ReactElement } from "react";
import { AgentRuntimeIcon } from "@/components/features/agents/agent-runtime-icon";
import { Button } from "@/components/ui/button";
import { RunningStatusDot } from "@/components/ui/running-status-dot";
import { useSessionUnread } from "@/features/session-navigation/session-read-state";
import { cn } from "@/lib/utils";
import type {
  SessionNavigationEntry,
  SessionNavigationSourceIssue,
} from "@/state/read-models/session-navigation-read-model";
import {
  ATTENTION_REASON_LABELS,
  sessionEntryRuntimeLabel,
  sessionSourceIssueText,
} from "./session-navigation-entry-model";

export function AttentionBadge({
  label,
  className,
}: {
  label: string;
  className?: string;
}): ReactElement {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md border border-warning-border bg-warning-surface px-1.5 py-0.5 text-[11px] font-medium leading-none text-warning-muted",
        className,
      )}
    >
      {label}
    </span>
  );
}

/** Keep requests visible without repeating the task's blocked status badge. */
export function AttentionBadges({ entry }: { entry: SessionNavigationEntry }): ReactElement | null {
  const taskIsBlocked = entry.context.kind === "task" && entry.context.task.status === "blocked";
  const reasons = entry.attention.filter((reason) => reason !== "blocked" || !taskIsBlocked);
  if (reasons.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {reasons.map((reason) => (
        <AttentionBadge key={reason} label={ATTENTION_REASON_LABELS[reason]} />
      ))}
    </span>
  );
}

/** The runtime comes from the saved session, including when its live status is lost. */
export function SessionEntryRuntimeIcon({
  entry,
}: {
  entry: SessionNavigationEntry;
}): ReactElement | null {
  if (entry.runtimeKind === null) return null;
  return (
    <span
      role="img"
      aria-label={`${sessionEntryRuntimeLabel(entry)} runtime`}
      className="flex shrink-0 items-center justify-center"
    >
      <AgentRuntimeIcon runtimeKind={entry.runtimeKind} className="size-3.5" />
    </span>
  );
}

/** A failure or lost status stays visible beside the entry. */
export function SessionEntryIssueIcon({
  entry,
  className,
}: {
  entry: SessionNavigationEntry;
  className?: string;
}): ReactElement | null {
  if (entry.fault) {
    return (
      <TriangleAlert
        className={cn("size-3.5 shrink-0 text-warning-accent", className)}
        aria-hidden="true"
      />
    );
  }
  if (entry.status.kind === "settled" && entry.status.failed) {
    return (
      <CircleAlert
        className={cn("size-3.5 shrink-0 text-destructive", className)}
        aria-hidden="true"
      />
    );
  }
  if (entry.status.kind === "unavailable") {
    return (
      <CircleAlert
        className={cn("size-3.5 shrink-0 text-sidebar-muted-foreground", className)}
        aria-hidden="true"
      />
    );
  }
  return null;
}

/** A shape cue for the current session, separate from its attention or activity color. */
export function SessionSelectionIndicator({ className }: { className?: string }): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-sidebar-accent-foreground",
        className,
      )}
    >
      <Check className="size-3" strokeWidth={3} />
    </span>
  );
}

type SessionEntryStatusDotProps = {
  entry: SessionNavigationEntry;
  id: string;
  className?: string;
};

/** Activity and read state share one fixed space in both sidebar layouts. */
export function SessionEntryStatusDot({
  entry,
  id,
  className,
}: SessionEntryStatusDotProps): ReactElement {
  const unread = useSessionUnread(entry);
  const waiting = entry.attention.length > 0;
  const running = entry.status.kind === "running" && !waiting;
  const readLabel = unread ? "Unread session" : "Session read";
  const label = running ? "Session running" : readLabel;
  let dotClassName = unread ? "bg-status-unread" : "bg-status-read";
  if (waiting) dotClassName = unread ? "bg-status-input-unread" : "bg-status-input-read";
  return (
    <span
      id={id}
      role="img"
      aria-label={label}
      className={cn("flex size-2.5 shrink-0 items-center justify-center", className)}
    >
      {running ? (
        <RunningStatusDot size="sm" />
      ) : (
        <span aria-hidden="true" className={cn("size-2.5 rounded-full", dotClassName)} />
      )}
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function SessionSourceIssues({
  issues,
  onRetry,
}: {
  issues: readonly SessionNavigationSourceIssue[];
  onRetry: (issue: SessionNavigationSourceIssue) => void;
}): ReactElement | null {
  if (issues.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Session list problems">
      {issues.map((issue) => (
        <li
          key={`${issue.workspace.workspaceId}:${issue.source}`}
          className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-surface px-2.5 py-2 text-xs text-warning-surface-foreground"
          role="alert"
        >
          <span className="min-w-0 flex-1 break-words">{sessionSourceIssueText(issue)}</span>
          {issue.source === "live_status" ? null : (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-6 shrink-0"
              aria-label={`Retry ${issue.workspace.workspaceName}`}
              title="Retry"
              onClick={() => onRetry(issue)}
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
