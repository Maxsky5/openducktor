import {
  resolveAgentStudioDefaultRoleForTask,
  type WorkflowRoleId as AgentRole,
  type ResolvedTaskCard as TaskCard,
  taskSessionHistory,
} from "@openducktor/workflows";
export {
  coerceVisibleSelectionToCatalog,
  isSameSelection,
  pickDefaultVisibleSelectionForCatalog,
} from "@openducktor/core";

import { isAgentSessionActivityActive } from "@openducktor/frontend-core/lib/agent-session-activity-state";
import {
  agentSessionIdentityKey,
  matchesAgentSessionIdentity,
  toAgentSessionIdentity,
} from "@openducktor/frontend-core/lib/agent-session-identity";
import { compareAgentSessionRecency } from "@openducktor/frontend-core/lib/agent-session-options";
import {
  type AgentSessionSummary,
  toAgentSessionSummary,
} from "@openducktor/frontend-core/sessions/agent-sessions-store";
import { isWorkflowAgentSession } from "@openducktor/frontend-core/sessions/agent-orchestrator/support/workflow-session";
import type {
  AgentSessionIdentity,
  AgentSessionState,
} from "@openducktor/frontend-core/types/agent-orchestrator";
import type { AgentSessionReadModelLoadState } from "@openducktor/frontend-core/types/agent-session-read-model";

export { toRightPanelStorageKey } from "./query-sync/agent-studio-navigation";

const ISO_TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}T[0-9:.+-]+(?:Z|[+-]\d{2}:\d{2})/;

export type CompletionTimestamp = {
  raw: string;
  timestamp: number;
};

type AgentStudioViewSessionSelection = {
  role: AgentRole | null;
  sessionIdentity: AgentSessionIdentity | null;
  sessionSummary: AgentSessionSummary | null;
};

export const parseTimestamp = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
};

export const extractCompletionTimestamp = (
  value: string | undefined,
): CompletionTimestamp | null => {
  if (!value) {
    return null;
  }
  const match = value.match(ISO_TIMESTAMP_PATTERN);
  if (!match?.[0]) {
    return null;
  }
  const timestamp = parseTimestamp(match[0]);
  if (timestamp === null) {
    return null;
  }
  return {
    raw: match[0],
    timestamp,
  };
};

type AgentStudioSessionSelectionInput = {
  sessionsForTask: AgentSessionSummary[];
  sessionExternalId: string | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole | null;
  selectedTask: TaskCard | null;
  sessionlessRole: AgentRole | null;
  keepExplicitRoleSessionless?: boolean;
};

const isActiveSessionSelectionCandidate = (session: AgentSessionSummary): boolean =>
  isAgentSessionActivityActive(session.activityState, session.statusUnavailableReason);

export const resolveAgentStudioSessionSelection = ({
  sessionsForTask,
  sessionExternalId,
  hasExplicitRoleParam,
  roleFromQuery,
  selectedTask,
  sessionlessRole,
  keepExplicitRoleSessionless = false,
}: AgentStudioSessionSelectionInput): {
  sessionSummary: AgentSessionSummary | null;
  role: AgentRole | null;
} => {
  const activeSessionSummary =
    sessionsForTask.reduce<AgentSessionSummary | null>((latest, session) => {
      if (!isActiveSessionSelectionCandidate(session)) {
        return latest;
      }
      if (!latest || compareAgentSessionRecency(session, latest) < 0) {
        return session;
      }
      return latest;
    }, null) ?? null;

  const latestSessionByRole = (role: AgentRole | null): AgentSessionSummary | null => {
    return sessionsForTask.reduce<AgentSessionSummary | null>((latest, session) => {
      if (session.role !== role) {
        return latest;
      }
      if (!latest || compareAgentSessionRecency(session, latest) < 0) {
        return session;
      }
      return latest;
    }, null);
  };

  const toSelection = (role: AgentRole | null, session: AgentSessionSummary | null) => {
    return {
      sessionSummary: session,
      role,
    };
  };

  if (sessionExternalId) {
    const explicitSession =
      sessionsForTask.find((session) => session.externalSessionId === sessionExternalId) ?? null;
    if (explicitSession) {
      return toSelection(explicitSession.role, explicitSession);
    }
    return toSelection(sessionlessRole, null);
  }

  if (hasExplicitRoleParam) {
    if (keepExplicitRoleSessionless) {
      return toSelection(roleFromQuery, null);
    }
    return toSelection(roleFromQuery, latestSessionByRole(roleFromQuery));
  }

  if (activeSessionSummary) {
    return toSelection(activeSessionSummary.role, activeSessionSummary);
  }

  if (!selectedTask) {
    return toSelection(sessionlessRole, null);
  }

  const defaultRole = resolveAgentStudioDefaultRoleForTask(selectedTask);
  const mostRecentSession = sessionsForTask.reduce<AgentSessionSummary | null>(
    (latest, session) => {
      if (!latest || compareAgentSessionRecency(session, latest) < 0) {
        return session;
      }
      return latest;
    },
    null,
  );

  const withRoleFallback = (session: AgentSessionSummary | null) =>
    toSelection(session?.role ?? defaultRole ?? sessionlessRole, session);

  const history = taskSessionHistory(selectedTask);
  for (const role of history.roles) {
    const preferred = latestSessionByRole(role);
    if (preferred) return toSelection(role, preferred);
  }
  return withRoleFallback(history.latest ? mostRecentSession : null);
};

export type AgentStudioRouteSessionResolution =
  | { kind: "none" }
  | { kind: "pending"; sessionExternalId: string }
  | { kind: "found"; session: AgentSessionSummary }
  | { kind: "missing"; sessionExternalId: string }
  | { kind: "failed"; sessionExternalId: string; message: string };

export const resolveAgentStudioRouteSession = ({
  isWorkspaceRestorePending,
  isLoadingTasks,
  sessionReadModelLoadState,
  sessions,
  taskId,
  sessionExternalId,
  sessionIdentity = null,
}: {
  isWorkspaceRestorePending: boolean;
  isLoadingTasks: boolean;
  sessionReadModelLoadState: AgentSessionReadModelLoadState;
  sessions: AgentSessionSummary[];
  taskId: string;
  sessionExternalId: string | null;
  sessionIdentity?: AgentSessionIdentity | null;
}): AgentStudioRouteSessionResolution => {
  if (isWorkspaceRestorePending || !sessionExternalId) {
    return { kind: "none" };
  }

  // Without the complete identity, the external ID must match exactly one session of the task.
  const matches = sessions.filter(
    (entry) =>
      entry.taskId === taskId &&
      (sessionIdentity
        ? matchesAgentSessionIdentity(entry, sessionIdentity)
        : entry.externalSessionId === sessionExternalId),
  );
  if (matches.length > 1) {
    return {
      kind: "failed",
      sessionExternalId,
      message: `More than one session of this task has the session ID "${sessionExternalId}". Open the session from the session list.`,
    };
  }
  const [session] = matches;
  if (session) {
    return { kind: "found", session };
  }

  if (sessionReadModelLoadState.kind === "failed") {
    return {
      kind: "failed",
      sessionExternalId,
      message: sessionReadModelLoadState.message,
    };
  }

  if (isLoadingTasks || sessionReadModelLoadState.kind !== "ready") {
    return { kind: "pending", sessionExternalId };
  }

  return { kind: "missing", sessionExternalId };
};

export const groupSessionsByTaskId = (
  sessions: AgentSessionSummary[],
): Map<string, AgentSessionSummary[]> => {
  const grouped = new Map<string, AgentSessionSummary[]>();
  for (const session of sessions) {
    const current = grouped.get(session.taskId);
    if (current) {
      current.push(session);
    } else {
      grouped.set(session.taskId, [session]);
    }
  }

  for (const [taskId, taskSessions] of grouped) {
    grouped.set(taskId, taskSessions.toSorted(compareAgentSessionRecency));
  }

  return grouped;
};

const findViewSessionCandidateByIdentity = (
  candidates: AgentSessionSummary[],
  sessionIdentity: AgentSessionIdentity,
): AgentSessionSummary | null => {
  return (
    candidates.find((candidate) => matchesAgentSessionIdentity(candidate, sessionIdentity)) ?? null
  );
};

const resolveViewSessionExternalId = ({
  sessionExternalId,
  candidates,
}: {
  sessionExternalId: string | null;
  candidates: AgentSessionSummary[];
}): string | null => {
  if (!sessionExternalId) {
    return null;
  }
  const belongsToVisibleSession = candidates.some(
    (candidate) => candidate.externalSessionId === sessionExternalId,
  );
  return belongsToVisibleSession ? sessionExternalId : null;
};

export const resolveAgentStudioViewSessionSelection = ({
  sessionSummaries,
  sessionExternalId,
  sessionIdentity,
  hasExplicitRoleParam,
  roleFromQuery,
  selectedTask,
  sessionlessRole,
  keepExplicitRoleSessionless = false,
}: {
  sessionSummaries: AgentSessionSummary[];
  sessionExternalId: string | null;
  sessionIdentity: AgentSessionIdentity | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole | null;
  selectedTask: TaskCard | null;
  sessionlessRole: AgentRole | null;
  keepExplicitRoleSessionless?: boolean;
}): AgentStudioViewSessionSelection => {
  if (sessionIdentity) {
    const matchingCandidate = findViewSessionCandidateByIdentity(sessionSummaries, sessionIdentity);
    return {
      role: matchingCandidate?.role ?? roleFromQuery,
      sessionIdentity,
      sessionSummary: matchingCandidate,
    };
  }

  const resolvedSessionExternalId = resolveViewSessionExternalId({
    sessionExternalId,
    candidates: sessionSummaries,
  });
  if (sessionExternalId && !resolvedSessionExternalId) {
    return {
      role: roleFromQuery,
      sessionIdentity: null,
      sessionSummary: null,
    };
  }
  const selection = resolveAgentStudioSessionSelection({
    sessionsForTask: sessionSummaries,
    sessionExternalId: resolvedSessionExternalId,
    hasExplicitRoleParam,
    roleFromQuery,
    selectedTask,
    sessionlessRole,
    keepExplicitRoleSessionless: keepExplicitRoleSessionless && resolvedSessionExternalId === null,
  });
  return {
    role: selection.role,
    sessionIdentity: selection.sessionSummary
      ? toAgentSessionIdentity(selection.sessionSummary)
      : null,
    sessionSummary: selection.sessionSummary,
  };
};

const isLiveAgentSessionState = (
  session: AgentSessionSummary | AgentSessionState,
): session is AgentSessionState => "messages" in session;

export const resolveAgentStudioBuilderSessionsForTask = ({
  taskId,
  candidateSessions,
  role,
}: {
  taskId: string;
  role: string;
  candidateSessions: Array<AgentSessionSummary | AgentSessionState | null>;
}): AgentSessionSummary[] => {
  if (!taskId) {
    return [];
  }

  const seenSessionKeys = new Set<string>();
  const sessions: AgentSessionSummary[] = [];

  for (const session of candidateSessions) {
    if (!session) {
      continue;
    }
    if (isLiveAgentSessionState(session)) {
      if (
        !isWorkflowAgentSession(session) ||
        session.sessionAssociation.role !== role ||
        session.sessionAssociation.taskId !== taskId
      ) {
        continue;
      }
    } else if (session.role !== role || session.taskId !== taskId) {
      continue;
    }
    const sessionKey = agentSessionIdentityKey(session);
    if (seenSessionKeys.has(sessionKey)) {
      continue;
    }
    seenSessionKeys.add(sessionKey);
    sessions.push(isLiveAgentSessionState(session) ? toAgentSessionSummary(session) : session);
  }

  return sessions;
};
