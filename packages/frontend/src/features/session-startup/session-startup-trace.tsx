import type { StartupStep } from "@openducktor/contracts";
import {
  Check,
  ChevronDown,
  Circle,
  CircleDashed,
  LoaderCircle,
  Minus,
  OctagonAlert,
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
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import type { StartupAttempt } from "@openducktor/frontend-core/sessions/startup/startup-attempt-store";
import {
  canOpenStartupSession,
  startupIsPending,
} from "@openducktor/frontend-core/sessions/startup/startup-navigation";
import { terminalCommandSucceeded } from "@openducktor/frontend-core/terminals/terminal-command-result";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { terminalCommandResultNotice } from "@/features/terminals/terminal-command-result";
import { BUILTIN_ROLE_LABELS, builtinRoleId } from "@openducktor/workflows";
import { startupPresentation, type StartupPresentation } from "./startup-presentation";

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

export function SessionStartupTrace({
  attempt,
  className,
  onOpen,
}: {
  attempt: StartupAttempt;
  className?: string;
  onOpen?: () => void;
}): ReactElement {
  const connection = useClientConnection();
  const presentation = startupPresentation(connection, attempt.id);
  const scroll = useRef<HTMLDivElement>(null);
  const rows = attempt.operations.flatMap((operation) =>
    operation.steps.map((step) => ({ step, id: `${operation.context.operationId}:${step.id}` })),
  );
  const instruction = attempt.instruction;
  const current = rows.findLast((row) => ["waiting", "running", "failed"].includes(row.step.state));
  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollTop = presentation.scrollTop;
  }, [presentation]);

  return (
    <div
      className={cn("flex min-h-0 min-w-0 flex-col gap-4", className)}
      data-startup-attempt={attempt.id}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p role="status" aria-live="polite" aria-atomic="true" className="text-sm font-medium">
            {phaseLabels[attempt.status.phase]}
            {current ? ` · ${current.step.label}` : ""}
          </p>
          <p className="mt-1 break-words text-xs text-muted-foreground">{attempt.label}</p>
          <p className="mt-1 break-words text-xs text-muted-foreground">
            {attempt.origin.scope.kind === "task"
              ? `Task ${attempt.origin.scope.taskId} · ${BUILTIN_ROLE_LABELS[builtinRoleId(attempt.origin.scope.role)]}`
              : "Workspace chat"}{" "}
            · <span className="font-mono">{attempt.origin.repoPath}</span>
          </p>
        </div>
        {attempt.status.phase === "ready" ? (
          <Badge variant="secondary">
            <Check aria-hidden="true" />
            Ready
          </Badge>
        ) : null}
      </div>
      {attempt.status.confirmation === "unconfirmed" ? (
        <p
          role="status"
          className="rounded-md border border-warning-border bg-warning-surface p-3 text-sm text-warning-surface-foreground"
        >
          Startup is not confirmed. Known progress stays here while the connection recovers. Inspect
          the session before you try again.
        </p>
      ) : null}
      <div
        ref={scroll}
        onScroll={(event) => {
          presentation.scrollTop = event.currentTarget.scrollTop;
        }}
        className="min-h-0 max-h-[48dvh] overflow-y-auto overscroll-contain pr-2 [overflow-anchor:none]"
      >
        <ol aria-label="Session startup steps" className="min-w-0">
          {rows.length ? (
            rows.map(({ step, id }) => (
              <StartupStepRow key={id} step={step} rowId={id} presentation={presentation} />
            ))
          ) : (
            <li className="flex items-center gap-3 text-sm">
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
        </ol>
      </div>
      {instruction?.state === "queued" ? (
        <p className="text-sm text-muted-foreground">The initial instruction is queued.</p>
      ) : null}
      {instruction?.state === "unknown" ? (
        <p className="text-sm text-warning-surface-foreground">
          Instruction delivery is not confirmed. Inspect the session before sending it again.
        </p>
      ) : null}
      {attempt.error ? (
        <p role="alert" className="break-words text-sm text-destructive">
          {attempt.error}
        </p>
      ) : null}
      <StartupSavedSession attempt={attempt} presentation={presentation} onOpen={onOpen} />
      <StartupRecoveryActions attempt={attempt} />
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
  const action = step.action;
  const hasDetails = hasStepDetails(step);
  const { status, actionFailed, stateLabel } = stepPresentation(step);
  const Icon = status.icon;

  return (
    <li className="relative min-w-0 pb-5 pl-8 last:pb-0 before:absolute before:bottom-0 before:left-[9px] before:top-6 before:w-px before:bg-border last:before:hidden">
      <span
        className={cn(
          "absolute left-0 top-0.5 flex size-5 items-center justify-center rounded-full bg-card",
          (step.state === "failed" || actionFailed) && "text-destructive",
        )}
      >
        <Icon
          aria-hidden="true"
          className={cn("size-4", step.state === "running" && "motion-safe:animate-spin")}
        />
      </span>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <p className="min-w-0 break-words text-sm font-medium">{step.label}</p>
        <span className="shrink-0 text-xs text-muted-foreground">{stateLabel}</span>
      </div>
      {step.failure ? (
        <p className="mt-1 break-words text-sm text-destructive">{step.failure.message}</p>
      ) : null}
      {hasDetails ? (
        <details
          open={expanded}
          onToggle={(event) => {
            const next = event.currentTarget.open;
            setExpanded(next);
            if (next) presentation.expandedSteps.add(rowId);
            else presentation.expandedSteps.delete(rowId);
          }}
          className="mt-1.5 min-w-0"
        >
          <summary className="w-fit cursor-pointer list-none rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-1">
              <ChevronDown aria-hidden="true" className={cn("size-3", !expanded && "-rotate-90")} />
              {action ? "Command and output" : "Details"}
            </span>
          </summary>
          <div className="mt-2 flex min-w-0 flex-col gap-2 text-xs text-muted-foreground">
            {step.details.map((detail, index) => (
              <p key={`${index}-${detail}`} className="break-words whitespace-pre-wrap">
                {detail}
              </p>
            ))}
            {action ? (
              <StartupActionDetails
                action={action}
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
            {step.failure ? <p>{step.failure.nextAction}</p> : null}
          </div>
        </details>
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
  const actionFailed = result && !terminalCommandSucceeded(result);
  const displayState = actionFailed ? "failed" : step.state;
  const status = stepStates[displayState];
  const stateLabel =
    action && !action.waitBeforeAgentStart && !result && step.state === "completed"
      ? "Started"
      : status.label;
  return { status, actionFailed, stateLabel };
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
        <Suspense fallback={<p>Loading command output…</p>}>
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
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={presentation.inspection.toggle}
          aria-expanded={inspect}
        >
          Inspect saved session
        </Button>
        {onOpen && canOpenStartupSession(attempt) ? (
          <Button type="button" size="sm" variant="outline" onClick={onOpen}>
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

function StartupRecoveryActions({ attempt }: { attempt: StartupAttempt }): ReactElement {
  const [actionError, setActionError] = useState<string | null>(null);
  const pending = startupIsPending(attempt);
  return (
    <>
      {!pending && attempt.recoveryActions?.length ? (
        <div className="flex flex-wrap gap-2">
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
