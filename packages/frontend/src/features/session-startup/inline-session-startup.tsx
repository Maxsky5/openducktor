import type { WorkflowRoleId as AgentRole } from "@openducktor/workflows";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { useSessionViewActive } from "@openducktor/frontend-core/sessions/navigation/session-view-context";
import {
  useInlineStartupAttempts,
  useInlineStartupLease,
} from "@openducktor/frontend-core/sessions/startup/use-startup-attempts";
import { startupIsPending } from "@openducktor/frontend-core/sessions/startup/startup-navigation";
import {
  startupFailureRows,
  startupHasWarningOrFailure,
  startupIsCleanReady,
  startupStepCounts,
} from "@openducktor/frontend-core/sessions/startup/startup-trace";
import type { StartupAttempt } from "@openducktor/frontend-core/sessions/startup/startup-attempt-store";
import { Check, LoaderCircle, OctagonAlert, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { REVEAL_ELEMENT_EVENT } from "@/lib/reveal-element";
import { cn } from "@/lib/utils";
import { TraceIcon } from "@/components/ui/trace";
import { STARTUP_TEXT_INSET } from "./constants";
import { StartupExpandChevron, StartupStepCounter } from "./startup-card-parts";
import { startupPresentation } from "./startup-presentation";
import {
  STARTUP_UNCONFIRMED_MESSAGE,
  startupActivity,
  startupIssue,
  startupOrigin,
  startupProgressToggleLabel,
  startupTitle,
  startupWarning,
} from "./startup-summary";
import { useOpenStartupSession } from "./use-open-startup-session";
import { StartupRecoveryActions, StartupTrace } from "./session-startup-trace";

type InlineStartupScope =
  | {
      kind: "task";
      repoPath: string | null;
      taskId: string | null | undefined;
      role: AgentRole | null;
    }
  | {
      kind: "workspace";
      repoPath: string | null;
      sessionId?: string | null | undefined;
      draftId?: string | null | undefined;
    };

type InlineStartupProps = {
  scope: InlineStartupScope;
  className?: string;
};

export function InlineStartup({ scope, className }: InlineStartupProps): ReactElement | null {
  const scopeKey =
    scope.kind === "task"
      ? JSON.stringify(["task", scope.repoPath, scope.taskId, scope.role])
      : JSON.stringify([
          "workspace",
          scope.repoPath,
          scope.sessionId ?? null,
          scope.draftId ?? null,
        ]);
  return <InlineStartupOwner key={scopeKey} scope={scope} className={className} />;
}

function InlineStartupOwner({
  scope,
  className,
}: {
  scope: InlineStartupScope;
  className?: string | undefined;
}): ReactElement | null {
  const active = useSessionViewActive();
  const matchingInline = useInlineStartupAttempts(scope, active);
  useInlineStartupLease({ scope }, active, {
    returnFromNotification: scope.kind === "workspace",
  });

  if (!active || matchingInline.length === 0) return null;
  return (
    <div className={cn("mb-4 flex w-full flex-col gap-2", className)}>
      {matchingInline.map((attempt) => (
        <InlineTraceCard key={attempt.id} attempt={attempt} scope={scope} />
      ))}
    </div>
  );
}

function InlineStatusIcon({
  attempt,
  pending,
  cleanReady,
  issue,
}: {
  attempt: StartupAttempt;
  pending: boolean;
  cleanReady: boolean;
  issue: string | undefined;
}): ReactElement {
  if (pending) {
    return (
      <LoaderCircle
        aria-hidden="true"
        className="size-4 text-info-surface-foreground motion-safe:animate-spin"
      />
    );
  }
  if (cleanReady) {
    return <Check aria-hidden="true" className="size-4 text-success-icon" />;
  }
  if (attempt.status.phase === "failed" || Boolean(issue) || attempt.status.phase === "canceled") {
    return <OctagonAlert aria-hidden="true" className="size-4 text-destructive" />;
  }
  return <TriangleAlert aria-hidden="true" className="size-4 text-warning-accent" />;
}

function inlineCardBorderClass(attempt: StartupAttempt, hasWarningOrFailure: boolean): string {
  if (attempt.status.phase === "failed") return "border-destructive/30";
  if (hasWarningOrFailure) return "border-warning-border";
  return "border-border";
}

function isAlreadyViewingSavedSession(attempt: StartupAttempt, scope: InlineStartupScope): boolean {
  if (attempt.ownership.state !== "saved") return false;
  if (scope.kind === "workspace") {
    return (
      Boolean(scope.sessionId) &&
      attempt.ownership.target.kind === "workspace" &&
      attempt.ownership.target.record.id === scope.sessionId
    );
  }
  return false;
}

type InlineSummaryLine = {
  key: string;
  text: string;
  role?: "alert" | "status";
  className?: string;
};

function buildInlineSummaryLines({
  attempt,
  scope,
  expanded,
  cleanReady,
  hasTrace,
  activity,
  issue,
  warning,
}: {
  attempt: StartupAttempt;
  scope: InlineStartupScope;
  expanded: boolean;
  cleanReady: boolean;
  hasTrace: boolean;
  activity: string | undefined;
  issue: string | undefined;
  warning: string | undefined;
}): InlineSummaryLine[] {
  const lines: InlineSummaryLine[] = [];
  if (scope.kind === "task" && !(cleanReady && !expanded)) {
    lines.push({ key: "origin", text: startupOrigin(attempt), className: "break-words" });
  }
  if (activity && (!expanded || !hasTrace)) {
    lines.push({ key: "activity", text: activity });
  }
  if (!expanded && attempt.status.confirmation === "unconfirmed") {
    lines.push({
      key: "unconfirmed",
      text: STARTUP_UNCONFIRMED_MESSAGE,
      className: "text-warning-surface-foreground",
    });
  }
  if (!expanded && issue) {
    lines.push({
      key: "issue",
      text: issue,
      role: "alert",
      className: "break-words text-destructive",
    });
  } else if (!expanded && warning) {
    lines.push({
      key: "warning",
      text: warning,
      role: "status",
      className: "break-words text-warning-surface-foreground",
    });
  }
  return lines;
}

function InlineTraceSummary({
  lines,
}: {
  lines: readonly InlineSummaryLine[];
}): ReactElement | null {
  if (lines.length === 0) return null;
  return (
    <div className="px-3.5 pb-2.5">
      <div
        className={cn(
          "flex min-w-0 flex-col gap-1 text-xs text-muted-foreground",
          STARTUP_TEXT_INSET,
        )}
      >
        {lines.map((line) => (
          <p key={line.key} role={line.role} className={line.className}>
            {line.text}
          </p>
        ))}
      </div>
    </div>
  );
}

function inlineTraceCanInspect(attempt: StartupAttempt, hasTrace: boolean): boolean {
  return (
    hasTrace ||
    attempt.ownership.state === "saved" ||
    startupFailureRows(attempt).length > 0 ||
    Boolean(attempt.error) ||
    Boolean(attempt.recoveryActions?.length)
  );
}

function inlineHeaderPaddingClass(pending: boolean): string {
  return pending ? "py-2.5 pl-3.5 pr-3.5" : "py-2.5 pl-3.5 pr-10";
}

function InlineTraceHeader({
  attempt,
  model,
  onToggle,
  onDismiss,
}: {
  attempt: StartupAttempt;
  model: InlineTraceCardModel;
  onToggle: () => void;
  onDismiss: () => void;
}): ReactElement {
  const headerContent = (
    <>
      <TraceIcon className="size-5">
        <InlineStatusIcon
          attempt={attempt}
          pending={model.pending}
          cleanReady={model.cleanReady}
          issue={model.issue}
        />
      </TraceIcon>
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="min-w-0 flex-1 truncate text-[13px] font-medium"
      >
        {model.title}
      </span>
      {model.hasTrace ? (
        <StartupStepCounter
          completed={model.progress.completed}
          total={model.progress.total}
          className="shrink-0"
        />
      ) : null}
      {model.canInspect ? <StartupExpandChevron expanded={model.expanded} /> : null}
    </>
  );

  const headerPaddingClass = inlineHeaderPaddingClass(model.pending);

  return (
    <div className="relative flex min-w-0 items-center">
      {model.canInspect ? (
        <button
          type="button"
          className={cn(
            "group/startup-toggle flex w-full min-w-0 cursor-pointer items-center gap-2 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            headerPaddingClass,
          )}
          aria-label={model.toggleAriaLabel}
          title={model.progressAction}
          aria-expanded={model.expanded}
          onClick={onToggle}
        >
          {headerContent}
        </button>
      ) : (
        <div className={cn("flex w-full min-w-0 items-center gap-2", headerPaddingClass)}>
          {headerContent}
        </div>
      )}
      {!model.pending ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-2.5 top-1/2 z-10 size-6 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label="Dismiss session startup"
          onClick={onDismiss}
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}

type UserToggleState = { open: boolean; settled: boolean } | null;
type InlineTraceCardModel = ReturnType<typeof deriveInlineTraceCardModel>;

function deriveInlineTraceCardModel(
  attempt: StartupAttempt,
  scope: InlineStartupScope,
  userToggle: UserToggleState,
) {
  const pending = startupIsPending(attempt);
  const hasWarningOrFailure = startupHasWarningOrFailure(attempt);
  const cleanReady = startupIsCleanReady(attempt);
  const progress = startupStepCounts(attempt);
  const hasTrace = progress.total > 0;
  const canInspect = inlineTraceCanInspect(attempt, hasTrace);
  const activity = startupActivity(attempt);
  const issue = startupIssue(attempt);
  const warning = startupWarning(attempt);
  const alreadyViewing = isAlreadyViewingSavedSession(attempt, scope);
  const expanded =
    userToggle !== null && (userToggle.settled || !cleanReady) ? userToggle.open : !cleanReady;
  const title = startupTitle(attempt);
  const progressAction = startupProgressToggleLabel(expanded, hasTrace, attempt.status.phase);
  const toggleAriaLabel = [title, activity, progressAction].filter(Boolean).join(". ");
  const summaryLines = buildInlineSummaryLines({
    attempt,
    scope,
    expanded,
    cleanReady,
    hasTrace,
    activity,
    issue,
    warning,
  });
  return {
    pending,
    hasWarningOrFailure,
    cleanReady,
    progress,
    hasTrace,
    canInspect,
    issue,
    expanded,
    compactReady: cleanReady && !expanded,
    title,
    progressAction,
    toggleAriaLabel,
    summaryLines,
    showOpenAction: !alreadyViewing,
    showSavedSession: !alreadyViewing || hasWarningOrFailure,
    showCollapsedRecovery: !expanded && !pending && Boolean(attempt.recoveryActions?.length),
  };
}

function InlineTraceCard({
  attempt,
  scope,
}: {
  attempt: StartupAttempt;
  scope: InlineStartupScope;
}): ReactElement {
  const connection = useClientConnection();
  const presentation = startupPresentation(connection, attempt.id);
  const { openSession, openError } = useOpenStartupSession(attempt);
  const cardRef = useRef<HTMLDivElement>(null);

  // Animate entry only on the first inline mount for an attempt, never again during draft -> chat handoff.
  const [animateEnter] = useState(() => !presentation.hasEnteredInline);
  useEffect(() => {
    presentation.hasEnteredInline = true;
  }, [presentation]);

  // Explicit user toggle overrides the phase-driven default (expanded while running or on
  // warnings/failures, auto-collapsed once cleanly settled).
  const [userToggle, setUserToggle] = useState<UserToggleState>(() =>
    presentation.detailsOpen !== undefined
      ? { open: presentation.detailsOpen, settled: presentation.settledAutoCollapsed }
      : null,
  );
  const model = deriveInlineTraceCardModel(attempt, scope, userToggle);

  const unpinTranscript = () => {
    cardRef.current?.dispatchEvent(new Event(REVEAL_ELEMENT_EVENT, { bubbles: true }));
  };

  const toggleDetails = () => {
    const next = !model.expanded;
    if (next) unpinTranscript();
    presentation.detailsOpen = next;
    if (model.cleanReady) presentation.settledAutoCollapsed = true;
    setUserToggle({ open: next, settled: model.cleanReady });
  };

  return (
    <div
      ref={cardRef}
      className={cn(
        animateEnter && "inline-startup-enter",
        "overflow-hidden rounded-xl border text-foreground transition-[background-color,border-color] duration-200 ease-out",
        model.compactReady ? "bg-card/70" : "bg-card/90",
        inlineCardBorderClass(attempt, model.hasWarningOrFailure),
      )}
    >
      <InlineTraceHeader
        attempt={attempt}
        model={model}
        onToggle={toggleDetails}
        onDismiss={() => connection.startupAttempts.dismiss(attempt.id)}
      />

      <InlineTraceSummary lines={model.summaryLines} />

      {model.canInspect && model.expanded ? (
        <div className="border-t border-border/60 px-3 py-2.5">
          <StartupTrace
            attempt={attempt}
            layout="inline"
            onExpandStep={unpinTranscript}
            onOpen={model.showOpenAction ? openSession : undefined}
            showHeader={false}
            showSavedSession={model.showSavedSession}
          />
        </div>
      ) : null}

      {model.showCollapsedRecovery ? (
        <div className="px-3.5 pb-2.5">
          <StartupRecoveryActions attempt={attempt} />
        </div>
      ) : null}

      {openError ? (
        <div className="px-3.5 pb-2.5">
          <p
            role="alert"
            className={cn("break-words text-xs text-destructive", STARTUP_TEXT_INSET)}
          >
            {openError}
          </p>
        </div>
      ) : null}
    </div>
  );
}
