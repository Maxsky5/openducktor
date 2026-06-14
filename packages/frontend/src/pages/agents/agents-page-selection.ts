export {
  coerceVisibleSelectionToCatalog,
  isSameSelection,
  pickDefaultVisibleSelectionForCatalog,
} from "@/features/session-start";

import type { AgentSessionRecord, TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { compareAgentSessionRecency } from "@/lib/agent-session-options";
import { isAgentSessionWorkingStatus } from "@/lib/agent-session-status";
import { buildRoleWorkflowMapForTask } from "@/lib/task-agent-workflows";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionRouteIdentity } from "@/types/agent-orchestrator";
import type { AgentStudioSessionRouteParam } from "./agent-studio-navigation";
import { AGENT_ROLE_ORDER } from "./agents-page-constants";

export {
  toContextStorageKey,
  toRightPanelStorageKey,
  toTabsStorageKey,
} from "./agent-studio-navigation";

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

export type AgentStudioSessionSelectionCandidate = AgentSessionRouteIdentity & {
  role: AgentRole | null;
  startedAt: string;
  status?: AgentSessionSummary["status"];
};

type AgentStudioSessionSelectionInput<TSession extends AgentStudioSessionSelectionCandidate> = {
  sessionsForTask: TSession[];
  sessionParam: AgentStudioSessionRouteParam | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
  selectedTask: TaskCard | null;
  fallbackRole: AgentRole;
  keepExplicitRoleSessionless?: boolean;
};

export const resolveAgentStudioSessionSelectionFromCandidates = <
  TSession extends AgentStudioSessionSelectionCandidate,
>({
  sessionsForTask,
  sessionParam,
  hasExplicitRoleParam,
  roleFromQuery,
  selectedTask,
  fallbackRole,
  keepExplicitRoleSessionless = false,
}: AgentStudioSessionSelectionInput<TSession>): {
  activeSession: TSession | null;
  role: AgentRole;
} => {
  const runningSession =
    sessionsForTask.reduce<TSession | null>((latest, session) => {
      if (session.role === null || !isAgentSessionWorkingStatus(session.status ?? "idle")) {
        return latest;
      }
      if (!latest || compareAgentSessionRecency(session, latest) < 0) {
        return session;
      }
      return latest;
    }, null) ?? null;

  const latestSessionByRole = (role: AgentRole): TSession | null => {
    return sessionsForTask.reduce<TSession | null>((latest, session) => {
      if (session.role !== role) {
        return latest;
      }
      if (!latest || compareAgentSessionRecency(session, latest) < 0) {
        return session;
      }
      return latest;
    }, null);
  };

  const toSelection = (role: AgentRole, session: TSession | null) => {
    return {
      activeSession: session,
      role,
    };
  };

  if (sessionParam) {
    const explicitSession = findAgentStudioSessionSelectionCandidate(sessionsForTask, sessionParam);
    if (explicitSession?.role) {
      return toSelection(explicitSession.role, explicitSession);
    }
    return toSelection(fallbackRole, null);
  }

  if (hasExplicitRoleParam) {
    if (keepExplicitRoleSessionless) {
      return toSelection(roleFromQuery, null);
    }
    return toSelection(roleFromQuery, latestSessionByRole(roleFromQuery));
  }

  if (runningSession?.role) {
    return toSelection(runningSession.role, runningSession);
  }

  if (!selectedTask) {
    return toSelection(fallbackRole, null);
  }

  const defaultRole = resolveAgentStudioDefaultRoleForTask(selectedTask);
  const mostRecentSession = sessionsForTask.reduce<TSession | null>((latest, session) => {
    if (session.role === null) {
      return latest;
    }
    if (!latest || compareAgentSessionRecency(session, latest) < 0) {
      return session;
    }
    return latest;
  }, null);

  const withRoleFallback = (session: TSession | null) =>
    toSelection(session?.role ?? defaultRole ?? fallbackRole, session);

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
      return toSelection(defaultRole ?? fallbackRole, null);
  }
};

export const findAgentStudioSessionSelectionCandidate = <
  TSession extends AgentStudioSessionSelectionCandidate,
>(
  sessions: TSession[],
  sessionParam: AgentStudioSessionRouteParam | null,
): TSession | null => {
  if (!sessionParam) {
    return null;
  }

  if (sessionParam.kind === "exact") {
    const identity = agentSessionIdentityKey(sessionParam.identity);
    return sessions.find((entry) => agentSessionIdentityKey(entry) === identity) ?? null;
  }

  const matches = sessions.filter(
    (entry) => entry.externalSessionId === sessionParam.externalSessionId,
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
};

export const resolveAgentStudioSessionSelection = (
  input: AgentStudioSessionSelectionInput<AgentSessionSummary>,
): { activeSession: AgentSessionSummary | null; role: AgentRole } =>
  resolveAgentStudioSessionSelectionFromCandidates(input);

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

type ViewSessionSelectionCandidate = AgentSessionRouteIdentity & {
  role: AgentRole | null;
  startedAt: string;
  status?: AgentSessionSummary["status"];
  summary: AgentSessionSummary | null;
};

const toSelectedSessionRoute = (session: AgentSessionRouteIdentity): AgentSessionRouteIdentity => ({
  externalSessionId: session.externalSessionId,
  runtimeKind: session.runtimeKind,
  workingDirectory: session.workingDirectory,
});

const toSummaryViewSessionCandidate = (
  session: AgentSessionSummary,
): ViewSessionSelectionCandidate => ({
  externalSessionId: session.externalSessionId,
  runtimeKind: session.runtimeKind,
  workingDirectory: session.workingDirectory,
  role: session.role,
  startedAt: session.startedAt,
  status: session.status,
  summary: session,
});

const toPersistedViewSessionCandidate = (
  record: AgentSessionRecord,
): ViewSessionSelectionCandidate => ({
  externalSessionId: record.externalSessionId,
  runtimeKind: record.runtimeKind,
  workingDirectory: record.workingDirectory,
  role: record.role,
  startedAt: record.startedAt,
  summary: null,
});

const buildViewSessionSelectionCandidates = (
  sessionSummaries: AgentSessionSummary[],
  persistedRecords: AgentSessionRecord[],
): ViewSessionSelectionCandidate[] => {
  const summarySessionKeys = new Set(sessionSummaries.map(agentSessionIdentityKey));
  return [
    ...sessionSummaries.map(toSummaryViewSessionCandidate),
    ...persistedRecords
      .filter((record) => !summarySessionKeys.has(agentSessionIdentityKey(record)))
      .map(toPersistedViewSessionCandidate),
  ];
};

const resolveViewSessionParam = ({
  sessionParam,
  candidates,
}: {
  sessionParam: AgentStudioSessionRouteParam | null;
  candidates: ViewSessionSelectionCandidate[];
}): AgentStudioSessionRouteParam | null => {
  if (!sessionParam) {
    return null;
  }
  const belongsToVisibleSession =
    findAgentStudioSessionSelectionCandidate(candidates, sessionParam) !== null;
  return belongsToVisibleSession ? sessionParam : null;
};

export const resolveAgentStudioViewSessionSelection = ({
  sessionSummaries,
  persistedRecords,
  sessionParam,
  hasExplicitRoleParam,
  roleFromQuery,
  selectedTask,
  fallbackRole,
  keepExplicitRoleSessionless = false,
}: {
  sessionSummaries: AgentSessionSummary[];
  persistedRecords: AgentSessionRecord[];
  sessionParam: AgentStudioSessionRouteParam | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
  selectedTask: TaskCard | null;
  fallbackRole: AgentRole;
  keepExplicitRoleSessionless?: boolean;
}): {
  role: AgentRole;
  sessionRoute: AgentSessionRouteIdentity | null;
  sessionSummary: AgentSessionSummary | null;
} => {
  const candidates = buildViewSessionSelectionCandidates(sessionSummaries, persistedRecords);
  const resolvedSessionParam = resolveViewSessionParam({
    sessionParam,
    candidates,
  });
  const selection = resolveAgentStudioSessionSelectionFromCandidates({
    sessionsForTask: candidates,
    sessionParam: resolvedSessionParam,
    hasExplicitRoleParam,
    roleFromQuery,
    selectedTask,
    fallbackRole,
    keepExplicitRoleSessionless: keepExplicitRoleSessionless && resolvedSessionParam === null,
  });
  return {
    role: selection.role,
    sessionRoute: selection.activeSession ? toSelectedSessionRoute(selection.activeSession) : null,
    sessionSummary: selection.activeSession?.summary ?? null,
  };
};

export const resolveAgentStudioBuilderSessionsForTask = ({
  taskId,
  viewActiveSession,
  activeSession,
  selectedSessionById,
  viewSessionsForTask,
  sessionsForTask,
}: {
  taskId: string;
  viewActiveSession: AgentSessionSummary | null;
  activeSession: AgentSessionSummary | null;
  selectedSessionById: AgentSessionSummary | null;
  viewSessionsForTask: AgentSessionSummary[];
  sessionsForTask: AgentSessionSummary[];
}): AgentSessionSummary[] => {
  if (!taskId) {
    return [];
  }

  const seenSessionKeys = new Set<string>();
  const candidates = [
    viewActiveSession,
    activeSession,
    selectedSessionById,
    ...viewSessionsForTask,
    ...sessionsForTask,
  ];
  const sessions: AgentSessionSummary[] = [];

  for (const session of candidates) {
    if (session?.role !== "build" || session.taskId !== taskId) {
      continue;
    }
    const sessionKey = agentSessionIdentityKey(session);
    if (seenSessionKeys.has(sessionKey)) {
      continue;
    }
    seenSessionKeys.add(sessionKey);
    sessions.push(session);
  }

  return sessions;
};

export const resolveAgentStudioBuilderSessionForTask = ({
  taskId,
  viewActiveSession,
  activeSession,
  selectedSessionById,
  viewSessionsForTask,
  sessionsForTask,
}: {
  taskId: string;
  viewActiveSession: AgentSessionSummary | null;
  activeSession: AgentSessionSummary | null;
  selectedSessionById: AgentSessionSummary | null;
  viewSessionsForTask: AgentSessionSummary[];
  sessionsForTask: AgentSessionSummary[];
}): AgentSessionSummary | null => {
  return (
    resolveAgentStudioBuilderSessionsForTask({
      taskId,
      viewActiveSession,
      activeSession,
      selectedSessionById,
      viewSessionsForTask,
      sessionsForTask,
    })[0] ?? null
  );
};
