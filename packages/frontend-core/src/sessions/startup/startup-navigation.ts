import type { StartupAttempt } from "./startup-attempt-store";
import type { StartupOwnership } from "@openducktor/contracts";
import type { SessionNavigationTarget } from "../navigation/session-navigation-target";
import { builtinRoleId } from "@openducktor/workflows";

export function startupIsPending(attempt: StartupAttempt | null | undefined): boolean {
  if (!attempt) return false;
  return (
    attempt.status.confirmation === "unconfirmed" ||
    !["ready", "failed", "canceled"].includes(attempt.status.phase)
  );
}

export function startupNavigationTarget(
  attempt: StartupAttempt,
  ownership: StartupOwnership,
): SessionNavigationTarget | undefined {
  if (ownership.state !== "saved") return undefined;
  if (ownership.target.kind === "workspace")
    return ownership.target.record.externalSessionId
      ? {
          kind: "workspace_session",
          workspaceId: attempt.origin.workspaceId,
          sessionId: ownership.target.record.id,
        }
      : undefined;
  if (attempt.origin.scope.kind !== "task") return undefined;
  return {
    kind: "task_session",
    workspaceId: attempt.origin.workspaceId,
    taskId: attempt.origin.scope.taskId,
    role: builtinRoleId(attempt.origin.scope.role),
    identity: ownership.target.record,
  };
}

type OpenableStartupAttempt = StartupAttempt & {
  ownership: Extract<StartupAttempt["ownership"], { state: "saved" }>;
  navigationTarget: NonNullable<StartupAttempt["navigationTarget"]>;
};

export function canOpenStartupSession(
  attempt: StartupAttempt | null | undefined,
): attempt is OpenableStartupAttempt {
  return (
    attempt?.ownership.state === "saved" &&
    attempt.ownership.target.record.externalSessionId !== null &&
    attempt.navigationTarget !== undefined &&
    !startupIsPending(attempt)
  );
}
