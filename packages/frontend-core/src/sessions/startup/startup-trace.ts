import type { StartupOperationSnapshot, StartupStep } from "@openducktor/contracts";
import { terminalCommandSucceeded } from "../../terminals/terminal-command-result";
import type { StartupAttempt } from "./startup-attempt-store";

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
  if (!attempt.operations.some(createdWorktree)) return [];

  return attempt.operations.flatMap((operation) => {
    const createsWorktree = createdWorktree(operation);
    return stepsAfterCleanup(operation)
      .filter(
        (step) =>
          (createsWorktree &&
            (step.id === "checkout" ||
              step.id === "upstream" ||
              (step.id === "copies" && step.details.length > 0) ||
              Boolean(step.action) ||
              step.id === "cleanup")) ||
          stepHasFailure(step),
      )
      .map((step) => ({ id: `${operation.context.operationId}:${step.id}`, step }));
  });
}

export function startupFailureRows(attempt: StartupAttempt): { id: string; step: StartupStep }[] {
  return attempt.operations.flatMap((operation) =>
    stepsAfterCleanup(operation)
      .filter(
        (step) =>
          stepHasFailure(step) ||
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

function createdWorktree(operation: StartupOperationSnapshot): boolean {
  // Planned setup steps do not prove that Git created a worktree.
  return operation.steps.some(
    (step) =>
      step.id === "checkout" &&
      step.resources?.some(
        (resource) => resource.kind === "worktree" && resource.state === "created",
      ),
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

function stepHasFailure(step: StartupStep): boolean {
  return (
    step.state === "failed" ||
    Boolean(step.failure) ||
    Boolean(step.action?.result && !terminalCommandSucceeded(step.action.result))
  );
}
