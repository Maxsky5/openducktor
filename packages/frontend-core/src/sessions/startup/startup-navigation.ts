import type { StartupAttempt } from "./startup-attempt-store";
import type { StartupOwnership } from "@openducktor/contracts";
import type { WorkflowRoleId as AgentRole } from "@openducktor/workflows";
import type { SessionNavigationTarget } from "../navigation/session-navigation-target";

export type StartupScopeMatcher =
  | {
      kind: "task";
      repoPath?: string | null;
      workspaceId?: string | null;
      taskId: string | null | undefined;
      role: AgentRole | null;
    }
  | {
      kind: "workspace";
      repoPath?: string | null;
      workspaceId?: string | null;
      sessionId?: string | null | undefined;
      draftId?: string | null | undefined;
    };

export function matchesStartupScope(attempt: StartupAttempt, scope: StartupScopeMatcher): boolean {
  if (scope.repoPath !== undefined && attempt.origin.repoPath !== scope.repoPath) return false;
  if (scope.workspaceId !== undefined && attempt.origin.workspaceId !== scope.workspaceId) {
    return false;
  }
  if (scope.kind === "task") {
    return (
      attempt.origin.scope.kind === "task" &&
      attempt.origin.scope.taskId === scope.taskId &&
      attempt.origin.scope.role === scope.role
    );
  }
  if (attempt.origin.scope.kind !== "workspace") return false;
  if (scope.sessionId) {
    if (attempt.origin.scope.sessionId === scope.sessionId) return true;
    return (
      attempt.ownership.state === "saved" &&
      attempt.ownership.target.kind === "workspace" &&
      attempt.ownership.target.record.id === scope.sessionId
    );
  }
  if (scope.draftId) {
    return attempt.origin.scope.draftId === scope.draftId;
  }
  return false;
}

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
  if (ownership.state === "saved") {
    if (ownership.target.kind === "workspace") {
      return {
        kind: "workspace_session",
        workspaceId: attempt.origin.workspaceId,
        sessionId: ownership.target.record.id,
      };
    }
    if (attempt.origin.scope.kind !== "task") return undefined;
    return {
      kind: "task_session",
      workspaceId: attempt.origin.workspaceId,
      taskId: attempt.origin.scope.taskId,
      role: attempt.origin.scope.role,
      identity: ownership.target.record,
    };
  }
  if (attempt.origin.scope.kind === "workspace" && attempt.origin.scope.draftId) {
    return {
      kind: "workspace_session_draft",
      workspaceId: attempt.origin.workspaceId,
      draftId: attempt.origin.scope.draftId,
    };
  }
  return undefined;
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

type SavedWorkspaceStartupAttempt = StartupAttempt & {
  ownership: {
    state: "saved";
    target: Extract<Extract<StartupOwnership, { state: "saved" }>["target"], { kind: "workspace" }>;
  };
  navigationTarget: Extract<SessionNavigationTarget, { kind: "workspace_session" }>;
};

export function canOpenWorkspaceStartupRecovery(
  attempt: StartupAttempt | null | undefined,
): attempt is SavedWorkspaceStartupAttempt {
  return (
    attempt?.ownership.state === "saved" &&
    attempt.ownership.target.kind === "workspace" &&
    attempt.navigationTarget?.kind === "workspace_session"
  );
}

/**
 * Determines whether a startup attempt can be opened from a notification or dialog button:
 * settled saved sessions, saved workspace sessions in recovery, and unsaved workspace drafts.
 */
export function canOpenStartupAttempt(
  attempt: StartupAttempt | null | undefined,
): attempt is StartupAttempt & {
  navigationTarget: NonNullable<StartupAttempt["navigationTarget"]>;
} {
  if (!attempt?.navigationTarget) return false;
  if (canOpenStartupSession(attempt)) return true;
  if (attempt.presentation !== "notification") return false;
  if (canOpenWorkspaceStartupRecovery(attempt)) return true;
  return attempt.navigationTarget.kind === "workspace_session_draft";
}

/** Finds the most recent tracked startup attempt originated by `draftId`, if any. */
export function findDraftStartupAttempt(
  attempts: readonly StartupAttempt[],
  draftId: string,
): StartupAttempt | null {
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    const attempt = attempts[index];
    if (attempt?.origin.scope.kind === "workspace" && attempt.origin.scope.draftId === draftId) {
      return attempt;
    }
  }
  return null;
}

/**
 * Finds the most recent tracked startup attempt associated with a saved workspace session.
 * Used when reopening a workspace session row so in-flight, failed, or unconfirmed startup
 * attempts resume their existing recovery view instead of starting a duplicate request.
 */
export function findWorkspaceSessionStartupAttempt(
  attempts: readonly StartupAttempt[],
  workspaceId: string,
  sessionId: string,
): StartupAttempt | null {
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    const attempt = attempts[index];
    if (attempt && matchesStartupScope(attempt, { kind: "workspace", workspaceId, sessionId })) {
      return attempt;
    }
  }
  return null;
}

/** Finds a saved workspace session startup attempt originated by `draftId`, if any. */
export function findSavedWorkspaceStartupAttemptForDraft(
  attempts: readonly StartupAttempt[],
  draftId: string,
): SavedWorkspaceStartupAttempt | null {
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    const attempt = attempts[index];
    if (
      attempt &&
      attempt.origin.scope.kind === "workspace" &&
      attempt.origin.scope.draftId === draftId &&
      canOpenWorkspaceStartupRecovery(attempt)
    ) {
      return attempt;
    }
  }
  return null;
}
