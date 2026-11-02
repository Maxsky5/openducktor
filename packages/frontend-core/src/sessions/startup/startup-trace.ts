import type { StartupOperationSnapshot, StartupStep } from "@openducktor/contracts";
import { terminalCommandSucceeded } from "../../terminals/terminal-command-result";
import type { StartupAttempt } from "./startup-attempt-store";
import { startupIsPending } from "./startup-navigation";

export function startupShowsProgress(attempt: StartupAttempt | null): boolean {
  return (
    attempt !== null &&
    (startupTraceRows(attempt).length > 0 ||
      startupFailureRows(attempt).length > 0 ||
      attempt.operations.some(
        (operation) => operation.phase === "failed" || operation.phase === "canceled",
      ) ||
      attempt.status.phase === "failed" ||
      attempt.status.phase === "canceled" ||
      attempt.status.confirmation === "unconfirmed" ||
      attempt.instruction?.state === "unknown" ||
      Boolean(attempt.error))
  );
}

export function startupTraceRows(attempt: StartupAttempt): { id: string; step: StartupStep }[] {
  if (!attempt.operations.some(setsUpWorktree)) return [];

  const rows = attempt.operations.flatMap((operation) => {
    const createsWorktree = setsUpWorktree(operation);
    return stepsAfterCleanup(operation)
      .filter((step) => (createsWorktree && isSetupStep(step)) || startupStepHasFailure(step))
      .map((step) => ({ id: `${operation.context.operationId}:${step.id}`, step }));
  });
  // The session start follows the setup, so the trace shows it from the first snapshot.
  return [
    ...rows,
    {
      id: `${attempt.id}:session`,
      step: {
        id: "session",
        label: "Start session",
        state: sessionState(attempt, rows),
        details: [],
      },
    },
  ];
}

function isSetupStep(step: StartupStep): boolean {
  return (
    step.id === "checkout" ||
    step.id === "upstream" ||
    (step.id === "copies" && step.details.length > 0) ||
    Boolean(step.action) ||
    step.id === "cleanup"
  );
}

function sessionState(
  attempt: StartupAttempt,
  setup: readonly { step: StartupStep }[],
): StartupStep["state"] {
  const phase = attempt.status.phase;
  if (phase === "ready") return startupIsPending(attempt) ? "running" : "completed";
  if (phase === "canceled") return "not_run";
  // An action that continues in its terminal can end with an error after it started. That end
  // does not stop the session start.
  const setupFailed = setup.some(
    ({ step }) =>
      step.id !== "cleanup" &&
      isSetupStep(step) &&
      startupStepHasFailure(step) &&
      !(step.action?.waitBeforeAgentStart === false && step.action.result),
  );
  if (setupFailed && (phase === "failed" || phase === "settling")) return "not_run";
  if (phase === "failed") return "failed";
  // The host settles every launch, also a successful one, before the session is ready.
  if (phase === "settling") return "running";
  // An action that continues in its terminal does not hold the session start.
  const blocked = setup.some(
    ({ step }) =>
      step.state === "pending" ||
      step.state === "waiting" ||
      (step.state === "running" && step.action?.waitBeforeAgentStart !== false),
  );
  return blocked ? "pending" : "running";
}

export function startupFailureRows(attempt: StartupAttempt): { id: string; step: StartupStep }[] {
  return attempt.operations.flatMap((operation) =>
    stepsAfterCleanup(operation)
      .filter(
        (step) =>
          startupStepHasFailure(step) ||
          step.resources?.some(
            (resource) =>
              resource.state === "retained" ||
              resource.state === "unknown" ||
              Boolean(resource.nextAction),
          ),
      )
      .map((step) => ({ id: `${operation.context.operationId}:${step.id}`, step })),
  );
}

function setsUpWorktree(operation: StartupOperationSnapshot): boolean {
  const checkout = operation.steps.find((step) => step.id === "checkout");
  if (!checkout) return false;
  const created =
    checkout.resources?.some(
      (resource) => resource.kind === "worktree" && resource.state === "created",
    ) === true;
  // Only worktree creation plans a copy step, before Git starts. A checkout that stopped before
  // Git created the worktree shows only its failure. The host reports the created worktree in
  // the snapshot after the completed checkout, so a completed checkout keeps the trace.
  const planned =
    checkout.state !== "failed" &&
    checkout.state !== "not_run" &&
    operation.steps.some((step) => step.id === "copies");
  return created || planned;
}

function stepsAfterCleanup(operation: StartupOperationSnapshot): StartupStep[] {
  const removed = operation.steps.some((step) =>
    step.resources?.some(
      (resource) => resource.kind === "worktree" && resource.state === "removed",
    ),
  );
  if (!removed) return operation.steps;

  // Cleanup stops the action terminals before it removes their worktree.
  return operation.steps.map((step) => {
    if (!step.action?.terminalId) return step;
    const action = { ...step.action };
    delete action.terminalId;
    return { ...step, action, details: action.result ? [] : step.details };
  });
}

export function startupStepHasFailure(step: StartupStep): boolean {
  return (
    step.state === "failed" ||
    Boolean(step.failure) ||
    Boolean(step.action?.result && !terminalCommandSucceeded(step.action.result))
  );
}

/**
 * The step that a collapsed trace shows: the last step that runs, waits, or failed. Between two
 * steps, no step runs, so the next pending step shows and the line stays in place.
 */
export function startupActiveStep(rows: readonly { step: StartupStep }[]): StartupStep | undefined {
  const steps = rows.map(({ step }) => step);
  return (
    steps.findLast(
      (step) => step.state === "running" || step.state === "waiting" || startupStepHasFailure(step),
    ) ?? steps.find((step) => step.state === "pending")
  );
}
