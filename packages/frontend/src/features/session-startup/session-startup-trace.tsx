import type { StartupStep } from "@openducktor/contracts";
import { Check, Circle, CircleDashed, LoaderCircle, Minus, OctagonAlert } from "lucide-react";
import {
  lazy,
  type ReactElement,
  Suspense,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import type { StartupAttempt } from "@openducktor/frontend-core/sessions/startup/startup-attempt-store";
import {
  canOpenStartupSession,
  startupIsPending,
} from "@openducktor/frontend-core/sessions/startup/startup-navigation";
import { terminalCommandSucceeded } from "@openducktor/frontend-core/terminals/terminal-command-result";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { terminalCommandResultNotice } from "@/features/terminals/terminal-command-result";
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
import { startupOrigin, startupProgress, startupStepFailed } from "./startup-summary";

const StartupActionOutput = lazy(() =>
  import("./startup-action-output").then((module) => ({ default: module.StartupActionOutput })),
);

const stepStates = {
  pending: { label: "Pending", icon: Circle },
  waiting: { label: "Waiting", icon: CircleDashed },
  running: { label: "Running", icon: LoaderCircle },
  completed: { label: "Completed", icon: Check },
  failed: { label: "Failed", icon: OctagonAlert },
  not_run: { label: "Did not run", icon: Minus },
};

const phaseLabels = {
  submitting: "Submitting request",
  waiting: "Waiting to start",
  running: "Starting session",
  settling: "Finishing cleanup",
  ready: "Session ready",
  failed: "Startup failed",
  canceled: "Canceled",
};

export function StartupTrace({
  attempt,
  className,
  onOpen,
  showHeader = true,
}: {
  attempt: StartupAttempt;
  className?: string;
  onOpen?: () => void;
  showHeader?: boolean;
}): ReactElement {
  const connection = useClientConnection();
  const presentation = startupPresentation(connection, attempt.id);
  const scroll = useRef<HTMLElement>(null);
  const rows = attempt.operations.flatMap((operation) =>
    operation.steps.map((step) => ({ step, id: `${operation.context.operationId}:${step.id}` })),
  );
  const progress = startupProgress(attempt);
  const repeatedError = rows.some(
    ({ step }) =>
      step.failure &&
      (attempt.error === step.failure.message ||
        attempt.error === `${step.failure.message} ${step.failure.nextAction}`),
  );
  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollTop = presentation.scrollTop;
  }, [presentation]);
  return (
    <div
      className={cn("flex min-h-0 min-w-0 flex-col gap-3", className)}
      data-startup-attempt={attempt.id}
    >
      {showHeader ? (
        <div className="flex min-w-0 items-center justify-between gap-3 text-xs text-muted-foreground">
          <p title={attempt.origin.repoPath} className="min-w-0 truncate">
            {startupOrigin(attempt)}
          </p>
          <p role="status" aria-live="polite" aria-atomic="true" className="shrink-0 tabular-nums">
            <span className="sr-only">{phaseLabels[attempt.status.phase]}. </span>
            {progress.total
              ? `${progress.completed} of ${progress.total} steps`
              : phaseLabels[attempt.status.phase]}
          </p>
        </div>
      ) : null}
      <section
        ref={scroll}
        aria-label="Session startup details"
        tabIndex={0}
        onScroll={(event) => {
          presentation.scrollTop = event.currentTarget.scrollTop;
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1 [overflow-anchor:none]"
      >
        {attempt.status.confirmation === "unconfirmed" ? (
          <p
            role="status"
            className="rounded-md border border-warning-border bg-warning-surface px-3 py-2 text-xs text-warning-surface-foreground"
          >
            Startup is not confirmed. Inspect the saved session before starting or sending again.
          </p>
        ) : null}
        <Trace>
          <ul aria-label="Session startup steps" className="flex min-w-0 flex-col gap-1">
            {rows.length ? (
              rows.map(({ step, id }) => (
                <StartupStepRow key={id} step={step} rowId={id} presentation={presentation} />
              ))
            ) : (
              <li className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
                {attempt.status.phase === "submitting" ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="size-4 shrink-0 motion-safe:animate-spin"
                  />
                ) : null}
                {attempt.status.phase === "submitting"
                  ? "Submitting request"
                  : "No startup steps were reported."}
              </li>
            )}
          </ul>
        </Trace>
        {attempt.error && !repeatedError ? (
          <p role="alert" className="mt-2 break-words text-xs text-destructive">
            {attempt.error}
          </p>
        ) : null}
        {attempt.instruction?.state === "queued" ? (
          <p className="text-xs text-muted-foreground">The initial instruction is queued.</p>
        ) : null}
        {attempt.instruction?.state === "unknown" ? (
          <p className="text-xs text-warning-surface-foreground">
            Instruction delivery is unconfirmed. Inspect the session before sending again.
          </p>
        ) : null}
        <StartupSavedSession attempt={attempt} presentation={presentation} onOpen={onOpen} />
        <StartupRecoveryActions attempt={attempt} />
      </section>
    </div>
  );
}

function StartupStepRow({
  step,
  rowId,
  presentation,
}: {
  step: StartupStep;
  rowId: string;
  presentation: StartupPresentation;
}): ReactElement {
  const [expanded, setExpanded] = useState(() => presentation.expandedSteps.has(rowId));
  const row = useRef<HTMLLIElement>(null);
  const reveal = useRef(false);
  useLayoutEffect(() => {
    // Only an explicit expansion moves the viewport. Stream updates keep the reader's place.
    if (!expanded || !reveal.current) return;
    reveal.current = false;
    const frame = requestAnimationFrame(() => row.current?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [expanded]);
  const hasDetails = hasStepDetails(step);
  const { status, stateLabel, traceStatus } = stepPresentation(step);
  const Icon = status.icon;
  const failed = startupStepFailed(step);
  const line = (
    <TraceLine
      {...(traceStatus ? { status: traceStatus } : {})}
      className={cn(
        "min-h-7 w-full",
        step.state === "completed" && !failed && "text-foreground/80",
      )}
    >
      <TraceIcon>
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
    <li ref={row} className="min-w-0 scroll-mt-1">
      {hasDetails ? (
        <TraceCollapsible
          open={expanded}
          onOpenChange={(next) => {
            reveal.current = next;
            setExpanded(next);
            if (next) presentation.expandedSteps.add(rowId);
            else presentation.expandedSteps.delete(rowId);
          }}
        >
          <TraceCollapsibleTrigger className="w-full">{line}</TraceCollapsibleTrigger>
          <TraceCollapsibleContent className="flex flex-col gap-2 text-xs">
            {step.details.map((detail, index) => (
              <p key={`${index}-${detail}`} className="break-words whitespace-pre-wrap">
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
            {step.resources?.map((resource) => (
              <p key={`${resource.kind}-${resource.value}`} className="break-words">
                <span className="capitalize">{resource.kind}</span> {resource.state}:{" "}
                <span className="font-mono">{resource.value}</span>
                {resource.nextAction ? ` ${resource.nextAction}` : ""}
              </p>
            ))}
            {step.failure ? (
              <>
                <p className="max-h-32 overflow-y-auto break-words whitespace-pre-wrap">
                  {step.failure.message}
                </p>
                <p>{step.failure.nextAction}</p>
              </>
            ) : null}
          </TraceCollapsibleContent>
        </TraceCollapsible>
      ) : (
        <div>{line}</div>
      )}
      {step.failure && !expanded ? (
        <p className="mb-1 ml-6 break-words text-xs text-destructive">
          {step.action?.result
            ? terminalCommandResultNotice(step.action.result).text
            : step.failure.message}
        </p>
      ) : null}
    </li>
  );
}

function hasStepDetails(step: StartupStep): boolean {
  return (
    step.details.length > 0 ||
    Boolean(step.action) ||
    Boolean(step.resources?.length) ||
    Boolean(step.failure)
  );
}

function stepPresentation(step: StartupStep) {
  const action = step.action;
  const result = action?.result;
  const failed = startupStepFailed(step);
  const status = stepStates[failed ? "failed" : step.state];
  const stateLabel =
    action && !action.waitBeforeAgentStart && !result && step.state === "completed"
      ? "Started"
      : status.label;
  let traceStatus: "running" | "error" | "pending" | undefined;
  if (failed) traceStatus = "error";
  else if (step.state === "running") traceStatus = "running";
  else if (step.state === "pending" || step.state === "not_run") traceStatus = "pending";
  return { status, stateLabel, traceStatus };
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
    <>
      <pre className="max-w-full overflow-x-auto rounded-md border border-border bg-muted p-2 whitespace-pre-wrap break-words font-mono text-xs text-foreground">
        {action.command}
      </pre>
      <p>
        {action.waitBeforeAgentStart
          ? "Startup waits for this action."
          : "This action can continue in its terminal after the session is ready."}
      </p>
      {result ? (
        <p className={actionFailed ? "text-destructive" : undefined}>
          {terminalCommandResultNotice(result).text}
        </p>
      ) : null}
      {expanded && action.terminalId ? (
        <Suspense
          fallback={
            <p className="h-58" role="status">
              Loading command output…
            </p>
          }
        >
          <StartupActionOutput terminalId={action.terminalId} presentation={presentation} />
        </Suspense>
      ) : null}
      {!action.terminalId && result?.outputTail.length ? (
        <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted p-2 whitespace-pre-wrap break-words font-mono">
          {result.outputTail.join("\n")}
        </pre>
      ) : null}
    </>
  );
}

function StartupSavedSession({
  attempt,
  presentation,
  onOpen,
}: {
  attempt: StartupAttempt;
  presentation: StartupPresentation;
  onOpen?: (() => void) | undefined;
}): ReactElement | null {
  const inspect = useSyncExternalStore(
    presentation.inspection.subscribe,
    presentation.inspection.getSnapshot,
    presentation.inspection.getSnapshot,
  );
  const ownership = attempt.ownership;
  if (ownership.state !== "saved") return null;
  const saved = ownership.target;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs text-muted-foreground"
          onClick={presentation.inspection.toggle}
          aria-expanded={inspect}
        >
          Inspect saved session
        </Button>
        {onOpen && canOpenStartupSession(attempt) ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 px-2 text-xs"
            onClick={onOpen}
          >
            Open session
          </Button>
        ) : null}
      </div>
      {inspect ? (
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
      ) : null}
    </div>
  );
}

export function StartupRecoveryActions({ attempt }: { attempt: StartupAttempt }): ReactElement {
  const [actionError, setActionError] = useState<string | null>(null);
  const pending = startupIsPending(attempt);
  return (
    <>
      {!pending && attempt.recoveryActions?.length ? (
        <div className="flex flex-wrap gap-1.5">
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
        <p role="alert" className="text-sm text-destructive">
          {actionError}
        </p>
      ) : null}
    </>
  );
}
