import type { StartupStep } from "@openducktor/contracts";
import type { StartupAttempt } from "@openducktor/frontend-core/sessions/startup/startup-attempt-store";
import { terminalCommandSucceeded } from "@openducktor/frontend-core/terminals/terminal-command-result";
import { BUILTIN_ROLE_LABELS, builtinRoleId } from "@openducktor/workflows";
import { basenameForPath } from "@openducktor/path-support";
import { terminalCommandResultNotice } from "@/features/terminals/terminal-command-result";

export function startupIssue(attempt: StartupAttempt): string | undefined {
  const failed = attempt.operations
    .flatMap((operation) => operation.steps)
    .findLast(
      (step) =>
        step.action?.result &&
        !terminalCommandSucceeded(step.action.result) &&
        (!attempt.error ||
          attempt.error === step.failure?.message ||
          attempt.error === `${step.failure?.message} ${step.failure?.nextAction}`),
    );
  const result = failed?.action?.result;
  return result && !terminalCommandSucceeded(result)
    ? terminalCommandResultNotice(result).text
    : attempt.error;
}

export function startupActivity(attempt: StartupAttempt): string | undefined {
  const current = startupCurrentStep(attempt);
  if (current) return current.label;
  switch (attempt.status.phase) {
    case "submitting":
      return "Submitting request";
    case "waiting":
      return "Waiting for another operation";
    case "running":
      return "Preparing session";
    case "settling":
      return "Finishing cleanup";
    default:
      return undefined;
  }
}

export function startupTitle(attempt: StartupAttempt): string {
  const scope = attempt.origin.scope;
  const subject =
    scope.kind === "task" ? `${BUILTIN_ROLE_LABELS[builtinRoleId(scope.role)]} session` : "Chat";
  switch (attempt.status.phase) {
    case "ready":
      return startupCurrentStep(attempt)
        ? `${subject} ready with a setup error`
        : `${subject} ready`;
    case "failed":
      return `${subject} failed to start`;
    case "canceled":
      return `${subject} start canceled`;
    default:
      return scope.kind === "task" ? `Starting ${subject}` : "Starting chat";
  }
}

export function startupOrigin(attempt: StartupAttempt): string {
  const scope = attempt.origin.scope;
  const workspace = basenameForPath(attempt.origin.repoPath) || attempt.origin.repoPath;
  return scope.kind === "task" ? `${workspace} · ${scope.taskId}` : `${workspace} · Workspace chat`;
}

export function startupCurrentStep(attempt: StartupAttempt): StartupStep | undefined {
  const steps = attempt.operations.flatMap((operation) => operation.steps);
  if (attempt.status.phase === "ready")
    return steps.findLast((step) =>
      Boolean(step.action?.result && !terminalCommandSucceeded(step.action.result)),
    );
  return (
    steps.findLast((step) => step.state === "running" || step.state === "waiting") ??
    steps.findLast((step) => startupStepFailed(step))
  );
}

export function startupProgress(attempt: StartupAttempt) {
  const steps = attempt.operations.flatMap((operation) => operation.steps);
  return {
    completed: steps.filter((step) => step.state === "completed" && !startupStepFailed(step))
      .length,
    total: steps.length,
  };
}

export function startupStepFailed(step: StartupStep): boolean {
  return (
    step.state === "failed" ||
    Boolean(step.action?.result && !terminalCommandSucceeded(step.action.result))
  );
}
