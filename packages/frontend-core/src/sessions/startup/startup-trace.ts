import type { StartupOperationSnapshot, StartupStep } from "@openducktor/contracts";
import { terminalCommandSucceeded } from "../../terminals/terminal-command-result";
import type { StartupAttempt } from "./startup-attempt-store";
import { startupIsPending } from "./startup-navigation";

const INTERNAL_BOOKKEEPING_STEP_IDS = new Set([
  "request",
  "checks",
  "save",
  "bind",
  "publish",
  "handoff",
  "workflow",
  "waiting",
]);

const USER_FACING_STEP_IDS = new Set([
  "naming",
  "checkout",
  "upstream",
  "copies",
  "prepare",
  "instruction",
]);

const CLEANUP_STEP_IDS = new Set(["cleanup", "stop-session"]);

export type StartupStepDisplayState = StartupStep["state"] | "warning";

export function startupStepDisplayState(step: StartupStep): StartupStepDisplayState {
  if (startupStepHasFailure(step)) return "failed";
  if (startupStepHasWarning(step)) return "warning";
  return step.state;
}

export function startupStepHasDetails(step: StartupStep): boolean {
  return (
    Boolean(step.warning?.trim()) ||
    step.details.length > 0 ||
    Boolean(step.action) ||
    Boolean(step.resources?.length) ||
    Boolean(step.failure)
  );
}

export function startupIsCleanReady(attempt: StartupAttempt | null | undefined): boolean {
  return Boolean(
    attempt &&
    !startupIsPending(attempt) &&
    attempt.status.phase === "ready" &&
    !startupHasWarningOrFailure(attempt),
  );
}

export function startupStepHasWarning(step: StartupStep): boolean {
  return Boolean(step.warning);
}

export function startupStepHasFailure(step: StartupStep): boolean {
  return (
    step.state === "failed" ||
    Boolean(step.failure) ||
    Boolean(step.action?.result && !terminalCommandSucceeded(step.action.result))
  );
}

function stepHasResourceAttention(step: StartupStep): boolean {
  return Boolean(
    step.resources?.some(
      (resource) =>
        resource.state === "retained" ||
        resource.state === "unknown" ||
        Boolean(resource.nextAction),
    ),
  );
}

function isPrimaryTraceStep(attempt: StartupAttempt, step: StartupStep): boolean {
  if (CLEANUP_STEP_IDS.has(step.id)) return false;
  if (startupStepHasFailure(step) || startupStepHasWarning(step)) return true;
  if (INTERNAL_BOOKKEEPING_STEP_IDS.has(step.id)) return false;
  if (step.action) return true;
  if (step.id === "copies") return step.details.length > 0;
  if (step.id === "instruction") return attempt.instructionRequired || step.state !== "pending";
  return USER_FACING_STEP_IDS.has(step.id);
}

export function startupShowsProgress(attempt: StartupAttempt | null): boolean {
  return (
    attempt !== null &&
    (startupTraceRows(attempt).length > 0 || startupHasWarningOrFailure(attempt))
  );
}

export function startupTraceRows(attempt: StartupAttempt): { id: string; step: StartupStep }[] {
  const rows = attempt.operations.flatMap((operation) => {
    const steps = stepsAfterCleanup(operation);
    const hasPrimary = steps.some((step) => isPrimaryTraceStep(attempt, step));
    if (!hasPrimary) return [];
    return steps
      .filter(
        (step) =>
          isPrimaryTraceStep(attempt, step) ||
          (CLEANUP_STEP_IDS.has(step.id) &&
            (startupStepHasFailure(step) ||
              startupStepHasWarning(step) ||
              stepHasResourceAttention(step) ||
              step.state === "running" ||
              step.state === "completed")),
      )
      .map((step) => ({ id: `${operation.context.operationId}:${step.id}`, step }));
  });
  if (rows.length > 0) return rows;
  if (!startupIsPending(attempt) || attempt.presentation !== "inline") return [];
  return [
    {
      id: `${attempt.id}:submitting`,
      step: {
        id: "submitting",
        label: "Submitting request",
        state: "running",
        details: [],
      },
    },
  ];
}

export type StartupStepCounts = {
  completed: number;
  total: number;
};

export function startupStepCounts(attempt: StartupAttempt): StartupStepCounts {
  const rows = startupTraceRows(attempt);
  const completed = rows.filter(
    ({ step }) => step.state === "completed" && !startupStepHasFailure(step),
  ).length;
  return { completed, total: rows.length };
}

export function startupHasWarningOrFailure(attempt: StartupAttempt | null): boolean {
  if (!attempt) return false;
  if (
    attempt.status.phase === "failed" ||
    attempt.status.phase === "canceled" ||
    attempt.status.confirmation === "unconfirmed" ||
    attempt.instruction?.state === "unknown" ||
    Boolean(attempt.error)
  ) {
    return true;
  }
  return attempt.operations.some(
    (operation) =>
      operation.phase === "failed" ||
      operation.phase === "canceled" ||
      operation.steps.some(
        (step) =>
          startupStepHasFailure(step) ||
          startupStepHasWarning(step) ||
          stepHasResourceAttention(step),
      ),
  );
}

export function startupFailureRows(attempt: StartupAttempt): { id: string; step: StartupStep }[] {
  return attempt.operations.flatMap((operation) =>
    stepsAfterCleanup(operation)
      .filter((step) => startupStepHasFailure(step) || stepHasResourceAttention(step))
      .map((step) => ({ id: `${operation.context.operationId}:${step.id}`, step })),
  );
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

/**
 * The step that a collapsed trace shows: the last step that runs, waits, failed, or warned.
 * Between two steps, no step runs, so the next pending step shows and the line stays in place.
 */
export function startupActiveStep(rows: readonly { step: StartupStep }[]): StartupStep | undefined {
  const steps = rows.map(({ step }) => step);
  return (
    steps.findLast(
      (step) =>
        step.state === "running" ||
        step.state === "waiting" ||
        startupStepHasFailure(step) ||
        startupStepHasWarning(step),
    ) ?? steps.find((step) => step.state === "pending")
  );
}
