import type { StartupStep } from "@openducktor/contracts";
import {
  ArrowUpRight,
  Check,
  Circle,
  CircleDashed,
  LoaderCircle,
  Minus,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
import {
  lazy,
  type ReactElement,
  Suspense,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { STARTUP_TEXT_INSET } from "./constants";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import type { StartupAttempt } from "@openducktor/frontend-core/sessions/startup/startup-attempt-store";
import {
  canOpenStartupSession,
  startupIsPending,
} from "@openducktor/frontend-core/sessions/startup/startup-navigation";
import { terminalCommandSucceeded } from "@openducktor/frontend-core/terminals/terminal-command-result";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { actionResultText } from "./action-result-text";
import { startupPresentation, type StartupPresentation } from "./startup-presentation";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { startupOrigin } from "./startup-summary";
import {
  startupFailureRows,
  startupStepCounts,
  startupStepDisplayState,
  startupStepHasDetails,
  startupTraceRows,
  type StartupStepDisplayState,
} from "@openducktor/frontend-core/sessions/startup/startup-trace";

const loadStartupActionOutput = () =>
  import("./startup-action-output").then((module) => ({ default: module.StartupActionOutput }));

const StartupActionOutput = lazy(loadStartupActionOutput);

const stepStates = {
  pending: { label: "Pending", icon: Circle },
  waiting: { label: "Waiting", icon: CircleDashed },
  running: { label: "Running", icon: LoaderCircle },
  completed: { label: "Completed", icon: Check },
  warning: { label: "Warning", icon: TriangleAlert },
  failed: { label: "Failed", icon: OctagonAlert },
  not_run: { label: "Did not run", icon: Minus },
} satisfies Record<StartupStepDisplayState, { label: string; icon: typeof Circle }>;

const phaseLabels = {
  submitting: "Submitting request",
  waiting: "Waiting to start",
  running: "Starting session",
  settling: "Finishing cleanup",
  ready: "Session ready",
  failed: "Startup failed",
  canceled: "Canceled",
};

function StartupTraceHeader({
  attempt,
  hasRows,
  progress,
}: {
  attempt: StartupAttempt;
  hasRows: boolean;
  progress: ReturnType<typeof startupStepCounts>;
}): ReactElement {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 text-xs text-muted-foreground">
      <p title={attempt.origin.repoPath} className="min-w-0 truncate">
        {startupOrigin(attempt)}
      </p>
      {hasRows ? (
        <p role="status" aria-live="polite" aria-atomic="true" className="shrink-0 tabular-nums">
          <span className="sr-only">{phaseLabels[attempt.status.phase]}. </span>
          {progress.total
            ? `${progress.completed} of ${progress.total} steps`
            : phaseLabels[attempt.status.phase]}
        </p>
      ) : null}
    </div>
  );
}

function StartupTraceConfirmationBanner({
  attempt,
  showHeader,
  hasRows,
  progress,
}: {
  attempt: StartupAttempt;
  showHeader: boolean;
  hasRows: boolean;
  progress: ReturnType<typeof startupStepCounts>;
}): ReactElement | null {
  if (attempt.status.confirmation === "unconfirmed") {
    return (
      <p
        role="status"
        className="rounded-md border border-warning-border bg-warning-surface px-3 py-2 text-xs text-warning-surface-foreground"
      >
        Startup is not confirmed. Inspect the saved session before starting or sending again.
      </p>
    );
  }
  if (!showHeader && hasRows) {
    return (
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {phaseLabels[attempt.status.phase]}
        {progress.total ? `. ${progress.completed} of ${progress.total} steps` : ""}
      </p>
    );
  }
  return null;
}

export function StartupTrace({
  attempt,
  className,
  onOpen,
  onExpandStep,
  layout = "panel",
  showHeader = true,
  showSavedSession = true,
}: {
  attempt: StartupAttempt;
  className?: string;
  onOpen?: (() => void) | undefined;
  onExpandStep?: () => void;
  layout?: "panel" | "inline";
  showHeader?: boolean;
  showSavedSession?: boolean;
}): ReactElement {
  const connection = useClientConnection();
  const presentation = startupPresentation(connection, attempt.id);
  const inspect = useSyncExternalStore(
    presentation.inspection.subscribe,
    presentation.inspection.getSnapshot,
    presentation.inspection.getSnapshot,
  );
  const scroll = useRef<HTMLElement>(null);
  const rows = startupTraceRows(attempt);
  const failures = rows.length === 0 ? startupFailureRows(attempt) : [];
  const progress = startupStepCounts(attempt);
  const repeatedError = stepsShowError(attempt.error, [...rows, ...failures]);
  const isPanel = layout === "panel";

  useLayoutEffect(() => {
    if (isPanel && scroll.current) scroll.current.scrollTop = presentation.scrollTop;
  }, [isPanel, presentation]);

  return (
    <div
      className={cn("flex min-h-0 min-w-0 flex-col gap-2.5", className)}
      data-startup-attempt={attempt.id}
    >
      {showHeader ? (
        <StartupTraceHeader attempt={attempt} hasRows={rows.length > 0} progress={progress} />
      ) : null}
      <section
        ref={scroll}
        aria-label="Session startup details"
        tabIndex={isPanel ? 0 : undefined}
        onScroll={
          isPanel
            ? (event) => {
                presentation.scrollTop = event.currentTarget.scrollTop;
              }
            : undefined
        }
        className={cn(
          "min-h-0 min-w-0 space-y-2.5 overflow-x-hidden",
          isPanel && "flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]",
        )}
      >
        <StartupTraceConfirmationBanner
          attempt={attempt}
          showHeader={showHeader}
          hasRows={rows.length > 0}
          progress={progress}
        />
        {rows.length > 0 ? (
          <Trace>
            <ul aria-label="Session startup steps" className="flex w-full min-w-0 flex-col gap-0.5">
              {rows.map(({ step, id }) => (
                <StartupStepRow
                  key={id}
                  step={step}
                  rowId={id}
                  presentation={presentation}
                  onExpandStep={onExpandStep}
                />
              ))}
            </ul>
          </Trace>
        ) : (
          <StartupStatus attempt={attempt} />
        )}
        {attempt.error && !repeatedError ? (
          <p
            role="alert"
            className={cn("break-words text-xs text-destructive", STARTUP_TEXT_INSET)}
          >
            {attempt.error}
          </p>
        ) : null}
        {failures.map(({ id, step }) => (
          <div
            key={id}
            role="alert"
            className="flex min-w-0 flex-col gap-2 rounded-md border border-destructive/20 p-3 text-xs"
          >
            <p className="font-medium text-destructive">{step.label}</p>
            <StartupStepDetails step={step} expanded presentation={presentation} />
          </div>
        ))}
        <StartupInstructionStatus instruction={attempt.instruction} />
        {inspect ? <StartupSavedSessionDetails attempt={attempt} /> : null}
        <StartupRecoveryActions attempt={attempt} />
      </section>
      {showSavedSession ? (
        <StartupSavedSession
          attempt={attempt}
          inspect={inspect}
          onInspect={() => {
            if (!inspect) onExpandStep?.();
            presentation.inspection.toggle();
          }}
          onOpen={onOpen}
        />
      ) : null}
    </div>
  );
}

function stepsShowError(
  error: StartupAttempt["error"],
  rows: readonly { step: StartupStep }[],
): boolean {
  return rows.some(
    ({ step }) =>
      step.failure &&
      (error === step.failure.message ||
        error === `${step.failure.message} ${step.failure.nextAction}`),
  );
}

function StartupInstructionStatus({
  instruction,
}: {
  instruction: StartupAttempt["instruction"];
}): ReactElement | null {
  if (instruction?.state === "queued")
    return (
      <p className={cn("text-xs text-muted-foreground", STARTUP_TEXT_INSET)}>
        The initial instruction is queued.
      </p>
    );
  if (instruction?.state === "unknown")
    return (
      <p className={cn("text-xs text-warning-surface-foreground", STARTUP_TEXT_INSET)}>
        Instruction delivery is unconfirmed. Inspect the session before sending again.
        {instruction.submissionId ? (
          <>
            {" "}
            Submission ID: <span className="font-mono">{instruction.submissionId}</span>.
          </>
        ) : null}
      </p>
    );
  return null;
}

function StartupStatus({ attempt }: { attempt: StartupAttempt }): ReactElement {
  const pending = startupIsPending(attempt);
  const ready = !pending && attempt.status.phase === "ready";
  let Icon = OctagonAlert;
  if (pending) Icon = LoaderCircle;
  else if (ready) Icon = Check;
  else if (attempt.status.phase === "canceled") Icon = Minus;
  return (
    <p
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="flex items-center gap-2 py-1.5 text-sm"
    >
      <TraceIcon className="size-5">
        <Icon
          aria-hidden="true"
          className={cn(
            "size-4",
            pending && "text-info-surface-foreground motion-safe:animate-spin",
            ready && "text-success-icon",
            !pending && !ready && "text-destructive",
          )}
        />
      </TraceIcon>
      {pending && attempt.status.phase === "ready"
        ? "Waiting for session confirmation"
        : phaseLabels[attempt.status.phase]}
    </p>
  );
}

function StartupStepCollapsedNote({
  step,
  warned,
}: {
  step: StartupStep;
  warned: boolean;
}): ReactElement | null {
  if (step.failure) {
    return (
      <p className="mb-1 ml-9 break-words text-xs text-destructive">
        {step.action?.result ? actionResultText(step.action.result) : step.failure.message}
      </p>
    );
  }
  if (warned && step.warning) {
    return (
      <p className="mb-1 ml-9 break-words text-xs text-warning-surface-foreground">
        {step.warning}
      </p>
    );
  }
  return null;
}

function StartupStepRow({
  step,
  rowId,
  presentation,
  onExpandStep,
}: {
  step: StartupStep;
  rowId: string;
  presentation: StartupPresentation;
  onExpandStep?: (() => void) | undefined;
}): ReactElement {
  const [expanded, setExpanded] = useState(() => presentation.expandedSteps.has(rowId));
  const hasDetails = startupStepHasDetails(step);
  const { status, stateLabel, traceStatus, iconClass, lineClass, warned } = stepPresentation(step);
  const Icon = status.icon;
  const rowClass = cn(
    "w-full rounded-lg pr-2 transition-colors duration-150",
    hasDetails && "hover:bg-muted/60",
    step.state === "running" && "bg-info-surface/65",
    warned && "bg-warning-surface/50",
  );
  const preloadActionOutput = step.action?.terminalId
    ? () => {
        void loadStartupActionOutput();
      }
    : undefined;
  const handleOpenChange = (next: boolean) => {
    if (next) {
      onExpandStep?.();
      presentation.expandedSteps.add(rowId);
    } else {
      presentation.expandedSteps.delete(rowId);
    }
    setExpanded(next);
  };
  const line = (
    <TraceLine status={traceStatus} className={cn("min-h-8 w-full px-2 py-1.5", lineClass)}>
      <TraceIcon className={cn("size-5 rounded-full", iconClass)}>
        <Icon className={cn("size-3.5", step.state === "running" && "motion-safe:animate-spin")} />
      </TraceIcon>
      <TraceTitle className="flex-1 text-[13px]">{step.label}</TraceTitle>
      {stateLabel === "Completed" ? (
        <span className="sr-only">Completed</span>
      ) : (
        <TraceDescription className="text-[11px]">{stateLabel}</TraceDescription>
      )}
    </TraceLine>
  );
  return (
    <li className="min-w-0">
      {hasDetails ? (
        <TraceCollapsible open={expanded} onOpenChange={handleOpenChange}>
          <TraceCollapsibleTrigger
            className={rowClass}
            onPointerEnter={preloadActionOutput}
            onFocus={preloadActionOutput}
          >
            {line}
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent className="ml-[18px] mt-1 mb-1.5 flex min-w-0 max-w-full flex-col gap-2 border-border/80 pl-3.5 pr-1 py-1 text-xs">
            <StartupStepDetails step={step} expanded={expanded} presentation={presentation} />
          </TraceCollapsibleContent>
        </TraceCollapsible>
      ) : (
        // Keep the chevron column, so state labels line up with the rows that open.
        <div className={cn("flex min-w-0 items-center gap-1", rowClass)}>
          {line}
          <TraceIcon />
        </div>
      )}
      {!expanded ? <StartupStepCollapsedNote step={step} warned={warned} /> : null}
    </li>
  );
}

function StartupStepDetails({
  step,
  expanded,
  presentation,
}: {
  step: StartupStep;
  expanded: boolean;
  presentation: StartupPresentation;
}): ReactElement {
  // Completed worktree actions mirror `result.outputTail` into `step.details`; render it once in StartupActionDetails.
  // Also skip detail strings already shown verbatim in `step.resources`.
  const resourceValues = new Set(step.resources?.map((resource) => resource.value) ?? []);
  const visibleDetails = step.action?.result
    ? []
    : step.details.filter((detail) => !resourceValues.has(detail));
  return (
    <>
      {step.warning?.trim() ? (
        <p
          role="status"
          className="rounded-md border border-warning-border bg-warning-surface px-2.5 py-1.5 break-words text-warning-surface-foreground"
        >
          {step.warning}
        </p>
      ) : null}
      {visibleDetails.map((detail, index) => (
        <p
          key={`${index}-${detail}`}
          className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] text-muted-foreground"
        >
          {detail}
        </p>
      ))}
      {step.action ? (
        <StartupActionDetails
          action={step.action}
          expanded={expanded}
          presentation={presentation}
        />
      ) : null}
      {step.resources?.length ? (
        <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1 rounded-md border border-border/70 bg-muted/40 px-2.5 py-2 text-[11px]">
          {step.resources.map((resource) => (
            <div key={`${resource.kind}-${resource.value}`} className="contents">
              <dt className="shrink-0 capitalize text-muted-foreground">
                {resource.kind} {resource.state}
              </dt>
              <dd className="min-w-0 [overflow-wrap:anywhere]">
                <span className="font-mono text-foreground">{resource.value}</span>
                {resource.nextAction ? (
                  <span className="ml-1 text-muted-foreground">{resource.nextAction}</span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {step.failure ? (
        <>
          <p className="max-h-32 overflow-y-auto break-words whitespace-pre-wrap text-destructive">
            {step.failure.message}
          </p>
          <p>{step.failure.nextAction}</p>
        </>
      ) : null}
    </>
  );
}

function stepPresentation(step: StartupStep) {
  const action = step.action;
  const result = action?.result;
  const displayState = startupStepDisplayState(step);
  const failed = displayState === "failed";
  const warned = displayState === "warning";
  const status = stepStates[displayState];
  const stateLabel =
    action && !action.waitBeforeAgentStart && !result && step.state === "completed"
      ? "Started"
      : status.label;
  let traceStatus: "running" | "error" | "pending" | undefined;
  if (failed) traceStatus = "error";
  else if (displayState === "pending" || displayState === "not_run") traceStatus = "pending";
  let iconClass = "";
  let lineClass = "";
  if (failed) iconClass = "bg-destructive/10 text-destructive";
  else if (warned) {
    iconClass = "bg-warning-surface text-warning-accent";
    lineClass = "text-warning-surface-foreground";
  } else if (displayState === "completed") {
    iconClass = "bg-success-surface text-success-icon";
    lineClass = "text-foreground";
  } else if (displayState === "running") {
    iconClass = "bg-info-surface text-info-surface-foreground";
    lineClass = "font-medium text-foreground";
  }
  return { status, stateLabel, traceStatus, iconClass, lineClass, warned };
}

function StartupActionDetails({
  action,
  expanded,
  presentation,
}: {
  action: NonNullable<StartupStep["action"]>;
  expanded: boolean;
  presentation: StartupPresentation;
}): ReactElement {
  const result = action.result;
  const actionFailed = result && !terminalCommandSucceeded(result);
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-2">
      <pre className="max-w-full overflow-x-auto rounded-md border border-border/80 bg-muted/70 px-2.5 py-1.5 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground">
        {action.command}
      </pre>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          {action.waitBeforeAgentStart
            ? "Startup waits for this action."
            : "This action can continue in its terminal after the session is ready."}
        </span>
        {result ? (
          <span className={actionFailed ? "font-medium text-destructive" : "text-muted-foreground"}>
            {actionResultText(result)}
          </span>
        ) : null}
      </div>
      {expanded && action.terminalId ? (
        <Suspense
          fallback={
            <div className="flex min-w-0 max-w-full flex-col overflow-hidden rounded-md border border-border">
              <div className="flex items-center justify-between border-b border-border/80 bg-muted/50 px-2.5 py-1">
                <span className="text-[11px] font-medium text-muted-foreground">
                  Terminal output
                </span>
                <span className="h-6" aria-hidden="true" />
              </div>
              <div
                className="flex h-48 w-full items-center justify-center bg-[var(--terminal-panel)] text-xs text-muted-foreground"
                role="status"
              >
                Loading command output…
              </div>
            </div>
          }
        >
          <StartupActionOutput terminalId={action.terminalId} presentation={presentation} />
        </Suspense>
      ) : null}
      {!action.terminalId && result?.outputTail.length ? (
        <pre className="max-h-52 max-w-full overflow-auto rounded-md border border-border/80 bg-muted/70 p-2.5 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground">
          {result.outputTail.join("\n")}
        </pre>
      ) : null}
    </div>
  );
}

function StartupSavedSession({
  attempt,
  inspect,
  onInspect,
  onOpen,
}: {
  attempt: StartupAttempt;
  inspect: boolean;
  onInspect: () => void;
  onOpen?: (() => void) | undefined;
}): ReactElement | null {
  if (attempt.ownership.state !== "saved") return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-1.5">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs text-muted-foreground"
        onClick={onInspect}
        aria-expanded={inspect}
        aria-label="Inspect saved session"
      >
        Session details
      </Button>
      {onOpen && canOpenStartupSession(attempt) ? (
        <Button type="button" size="sm" variant="default" onClick={onOpen}>
          Open session
          <ArrowUpRight aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}

function StartupSavedSessionDetails({ attempt }: { attempt: StartupAttempt }): ReactElement | null {
  if (attempt.ownership.state !== "saved") return null;
  const saved = attempt.ownership.target;
  return (
    <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md border border-border bg-muted p-3 text-xs">
      <dt>Session</dt>
      <dd className="break-all font-mono">
        {saved.kind === "task" ? saved.record.externalSessionId : saved.record.id}
      </dd>
      <dt>Runtime</dt>
      <dd className="break-words">{saved.record.runtimeKind}</dd>
      <dt>Directory</dt>
      <dd className="break-all font-mono">
        {saved.kind === "task"
          ? saved.record.workingDirectory
          : saved.record.executionTarget.workingDirectory}
      </dd>
    </dl>
  );
}

export function StartupRecoveryActions({ attempt }: { attempt: StartupAttempt }): ReactElement {
  const [actionError, setActionError] = useState<string | null>(null);
  const pending = startupIsPending(attempt);
  return (
    <>
      {!pending && attempt.recoveryActions?.length ? (
        <div className={cn("flex flex-wrap gap-1.5", STARTUP_TEXT_INSET)}>
          {attempt.recoveryActions.map((action) => (
            <Button
              key={action.kind}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setActionError(null);
                void Promise.resolve()
                  .then(action.run)
                  .catch((cause: unknown) =>
                    setActionError(cause instanceof Error ? cause.message : String(cause)),
                  );
              }}
            >
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}
      {actionError ? (
        <p role="alert" className={cn("text-sm text-destructive", STARTUP_TEXT_INSET)}>
          {actionError}
        </p>
      ) : null}
    </>
  );
}
