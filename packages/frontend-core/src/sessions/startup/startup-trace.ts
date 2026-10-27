import type { StartupOperationSnapshot, StartupStep } from "@openducktor/contracts";
import { terminalCommandSucceeded } from "../../terminals/terminal-command-result";
import type { StartupAttempt } from "./startup-attempt-store";

export function startupTraceRows(attempt: StartupAttempt): { id: string; step: StartupStep }[] {
  if (!attempt.operations.some(createdWorktree)) return [];

  return attempt.operations.flatMap((operation) => {
    const createsWorktree = createdWorktree(operation);
    return operation.steps
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
    operation.steps
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

function stepHasFailure(step: StartupStep): boolean {
  return (
    step.state === "failed" ||
    Boolean(step.failure) ||
    Boolean(step.action?.result && !terminalCommandSucceeded(step.action.result))
  );
}
