export {
  coerceVisibleSelectionToCatalog,
  isSameSelection,
  pickDefaultVisibleSelectionForCatalog,
} from "@/features/session-start";

import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import { isAgentSessionActivityActive } from "@/lib/agent-session-activity-state";
import {
  agentSessionIdentityKey,
  matchesAgentSessionIdentity,
  toAgentSessionIdentity,
} from "@/lib/agent-session-identity";
import { compareAgentSessionRecency } from "@/lib/agent-session-options";
import { buildRoleWorkflowMapForTask } from "@/lib/task-agent-workflows";
import { type AgentSessionSummary, toAgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentSessionReadModelLoadState } from "@/types/agent-session-read-model";
import { AGENT_ROLE_ORDER } from "./agents-page-constants";

export {
  toContextStorageKey,
  toRightPanelStorageKey,
  toTabsStorageKey,
} from "./query-sync/agent-studio-navigation";

const ISO_TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}T[0-9:.+-]+(?:Z|[+-]\d{2}:\d{2})/;

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
): { raw: string; timestamp: number } | null => {
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

export const emptyDraftSelections = (): Record<AgentRole, AgentModelSelection | null> => ({
  spec: null,
  planner: null,
  build: null,
  qa: null,
});

export const resolveAgentStudioTaskId = ({
  taskIdParam,
  selectedSessionFromRoute,
}: {
  taskIdParam: string;
  selectedSessionFromRoute: AgentSessionSummary | null;
}): string => {
  return taskIdParam || selectedSessionFromRoute?.taskId || "";
};

export const resolveAgentStudioDefaultRoleForTask = (task: TaskCard | null): AgentRole | null => {
  if (!task) {
    return null;
  }

  if (task.status === "open") {
    const roleWorkflowMap = buildRoleWorkflowMapForTask(task);
    for (const role of AGENT_ROLE_ORDER) {
      const workflow = roleWorkflowMap[role];
      if (workflow.required && workflow.available) {
        return role;
      }
    }
    return null;
  }

  if (task.status === "spec_ready") {
    return "spec";
  }

  if (task.status === "ready_for_dev") {
    return "planner";
  }

  if (
    task.status === "in_progress" ||
    task.status === "ai_review" ||
    task.status === "human_review" ||
    task.status === "blocked" ||
    task.status === "closed"
  ) {
    return "build";
  }

  return null;
};

type AgentStudioSessionSelectionInput = {
  sessionsForTask: AgentSessionSummary[];
  sessionExternalId: string | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
  selectedTask: TaskCard | null;
  sessionlessRole: AgentRole;
  keepExplicitRoleSessionless?: boolean;
};

const isActiveSessionSelectionCandidate = (session: AgentSessionSummary): boolean =>
  isAgentSessionActivityActive(session.activityState);

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
  role: AgentRole;
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

  const latestSessionByRole = (role: AgentRole): AgentSessionSummary | null => {
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

  const toSelection = (role: AgentRole, session: AgentSessionSummary | null) => {
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

  switch (selectedTask.status) {
    case "open": {
      return withRoleFallback(defaultRole ? latestSessionByRole(defaultRole) : null);
    }
    case "spec_ready":
      return withRoleFallback(latestSessionByRole("spec"));
    case "ready_for_dev":
      return withRoleFallback(latestSessionByRole("planner") ?? latestSessionByRole("spec"));
    case "in_progress":
    case "ai_review":
    case "human_review":
      return withRoleFallback(latestSessionByRole("build"));
    case "blocked":
    case "closed":
      return withRoleFallback(latestSessionByRole("build") ?? mostRecentSession);
    default:
      return toSelection(defaultRole ?? sessionlessRole, null);
  }
};

export const findAgentStudioTaskSessionSummary = (
  sessions: AgentSessionSummary[],
  taskId: string,
  sessionExternalId: string | null,
): AgentSessionSummary | null => {
  if (!taskId || !sessionExternalId) {
    return null;
  }

  return (
    sessions.find(
      (entry) => entry.taskId === taskId && entry.externalSessionId === sessionExternalId,
    ) ?? null
  );
};

export type AgentStudioRouteSessionResolution =
  | { kind: "none" }
  | { kind: "pending"; sessionExternalId: string }
  | { kind: "found"; session: AgentSessionSummary }
  | { kind: "missing"; sessionExternalId: string }
  | { kind: "failed"; sessionExternalId: string; message: string };

export const resolveAgentStudioRouteSession = ({
  isRepoNavigationBoundaryPending,
  isLoadingTasks,
  sessionReadModelLoadState,
  sessions,
  taskId,
  sessionExternalId,
}: {
  isRepoNavigationBoundaryPending: boolean;
  isLoadingTasks: boolean;
  sessionReadModelLoadState: AgentSessionReadModelLoadState;
  sessions: AgentSessionSummary[];
  taskId: string;
  sessionExternalId: string | null;
}): AgentStudioRouteSessionResolution => {
  if (isRepoNavigationBoundaryPending || !sessionExternalId) {
    return { kind: "none" };
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

  const session = findAgentStudioTaskSessionSummary(sessions, taskId, sessionExternalId);
  return session ? { kind: "found", session } : { kind: "missing", sessionExternalId };
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
  roleFromQuery: AgentRole;
  selectedTask: TaskCard | null;
  sessionlessRole: AgentRole;
  keepExplicitRoleSessionless?: boolean;
}): {
  role: AgentRole;
  sessionIdentity: AgentSessionIdentity | null;
  sessionSummary: AgentSessionSummary | null;
} => {
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
}: {
  taskId: string;
  candidateSessions: Array<AgentSessionSummary | AgentSessionState | null>;
}): AgentSessionSummary[] => {
  if (!taskId) {
    return [];
  }

  const seenSessionKeys = new Set<string>();
  const sessions: AgentSessionSummary[] = [];

  for (const session of candidateSessions) {
    if (session?.role !== "build" || session.taskId !== taskId) {
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
