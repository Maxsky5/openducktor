import type { StartupStep } from "@openducktor/contracts";
import type { StartupAttempt } from "@openducktor/frontend-core/sessions/startup/startup-attempt-store";
import { terminalCommandSucceeded } from "@openducktor/frontend-core/terminals/terminal-command-result";
import { basenameForPath } from "@openducktor/path-support";
import { actionResultText } from "./action-result-text";
import {
  startupActiveStep,
  startupStepHasFailure,
  startupStepHasWarning,
  startupTraceRows,
} from "@openducktor/frontend-core/sessions/startup/startup-trace";

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
  return result && !terminalCommandSucceeded(result) ? actionResultText(result) : attempt.error;
}

export function startupWarning(attempt: StartupAttempt): string | undefined {
  const warned = attempt.operations
    .flatMap((operation) => operation.steps)
    .findLast((step) => startupStepHasWarning(step));
  return warned?.warning?.trim() || undefined;
}

export function startupActivity(attempt: StartupAttempt): string | undefined {
  const current = startupActiveStep(startupTraceRows(attempt));
  if (current) return current.label;
  switch (attempt.status.phase) {
    case "submitting":
      return "Submitting request";
    case "waiting":
      return "Waiting for another operation";
    case "running":
      return "Starting session";
    case "settling":
      return "Finishing cleanup";
    default:
      return undefined;
  }
}

export function startupTitle(attempt: StartupAttempt): string {
  const scope = attempt.origin.scope;
  const subject = scope.kind === "task" ? `${attempt.roleLabel ?? "Task"} session` : "Session";
  switch (attempt.status.phase) {
    case "ready": {
      if (startupCurrentStep(attempt)) return `${subject} ready with a setup error`;
      if (startupWarning(attempt)) return `${subject} ready with a warning`;
      return `${subject} ready`;
    }
    case "failed":
      return `${subject} failed to start`;
    case "canceled":
      return `${subject} start canceled`;
    default:
      return scope.kind === "task" ? `Starting ${subject}` : "Starting session";
  }
}

export function startupOrigin(attempt: StartupAttempt): string {
  const scope = attempt.origin.scope;
  const workspace = basenameForPath(attempt.origin.repoPath) || attempt.origin.repoPath;
  return scope.kind === "task"
    ? `${workspace} · ${scope.taskId}`
    : `${workspace} · Workspace session`;
}

export const STARTUP_UNCONFIRMED_MESSAGE =
  "Startup is not confirmed. Inspect the session before you try again.";

export function startupProgressToggleLabel(
  expanded: boolean,
  hasTrace: boolean,
  phase: StartupAttempt["status"]["phase"],
): string {
  if (expanded) return hasTrace ? "Hide progress" : "Hide details";
  return !hasTrace || phase === "ready" ? "Details" : "View progress";
}

function startupCurrentStep(attempt: StartupAttempt): StartupStep | undefined {
  const steps = attempt.operations.flatMap((operation) => operation.steps);
  if (attempt.status.phase === "ready")
    return steps.findLast((step) =>
      Boolean(step.action?.result && !terminalCommandSucceeded(step.action.result)),
    );
  return (
    steps.findLast((step) => step.state === "running" || step.state === "waiting") ??
    steps.findLast((step) => startupStepHasFailure(step))
  );
}
