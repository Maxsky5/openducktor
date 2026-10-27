import type { StartupStep } from "@openducktor/contracts";
import { terminalCommandSucceeded } from "../../terminals/terminal-command-result";
import type { StartupAttempt } from "./startup-attempt-store";

export function startupTraceRows(attempt: StartupAttempt): { id: string; step: StartupStep }[] {
  // Only new worktree creation declares copies, including an empty configured file list.
  if (!attempt.operations.some((operation) => operation.steps.some((step) => step.id === "copies")))
    return [];

  return attempt.operations.flatMap((operation) => {
    const createsWorktree = operation.steps.some((step) => step.id === "copies");
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

function stepHasFailure(step: StartupStep): boolean {
  return (
    step.state === "failed" ||
    Boolean(step.failure) ||
    Boolean(step.action?.result && !terminalCommandSucceeded(step.action.result))
  );
}
