export {
  coerceVisibleSelectionToCatalog,
  isSameSelection,
  pickDefaultVisibleSelectionForCatalog,
} from "@/features/session-start";

import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole, AgentScenario } from "@openducktor/core";
import { compareAgentSessionRecency } from "@/lib/agent-session-options";
import { buildRoleWorkflowMapForTask } from "@/lib/task-agent-workflows";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { firstScenario, SCENARIOS_BY_ROLE } from "./agents-page-constants";

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
  selectedSessionById,
}: {
  taskIdParam: string;
  selectedSessionById: AgentSessionState | null;
}): string => {
  return taskIdParam || selectedSessionById?.taskId || "";
};

export const resolveAgentStudioDefaultRoleForTask = (task: TaskCard | null): AgentRole | null => {
  if (!task) {
    return null;
  }

  if (task.status === "open") {
    const roleWorkflowMap = buildRoleWorkflowMapForTask(task);
    const orderedRoles: AgentRole[] = ["spec", "planner", "build", "qa"];
    for (const role of orderedRoles) {
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
    task.status === "deferred" ||
    task.status === "closed"
  ) {
    return "build";
  }

  return null;
};

export const resolveAgentStudioSessionSelection = ({
  sessionsForTask,
  sessionParam,
  hasExplicitRoleParam,
  roleFromQuery,
  selectedTask,
  fallbackRole,
  scenarioFromQuery,
}: {
  sessionsForTask: AgentSessionState[];
  sessionParam: string | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
  selectedTask: TaskCard | null;
  fallbackRole: AgentRole;
  scenarioFromQuery?: AgentScenario | null;
}): { activeSession: AgentSessionState | null; role: AgentRole; scenario: AgentScenario } => {
  const activeSession = sessionsForTask.find(
    (session) => session.status === "running" || session.status === "starting",
  );

  const latestSessionByRole = (role: AgentRole): AgentSessionState | null => {
    const roleSessions = sessionsForTask
      .filter((session) => session.role === role)
      .sort(compareAgentSessionRecency);
    return roleSessions[0] ?? null;
  };

  const toSelection = (role: AgentRole, session: AgentSessionState | null) => {
    const roleScenarios = SCENARIOS_BY_ROLE[role];
    const explicitScenarioForRole =
      hasExplicitRoleParam && scenarioFromQuery && roleScenarios.includes(scenarioFromQuery)
        ? scenarioFromQuery
        : null;

    const scenario =
      session?.scenario && roleScenarios.includes(session.scenario)
        ? session.scenario
        : (explicitScenarioForRole ?? firstScenario(role));

    return {
      activeSession: session,
      role,
      scenario,
    };
  };

  if (sessionParam) {
    const explicitSession =
      sessionsForTask.find((entry) => entry.sessionId === sessionParam) ?? null;
    if (explicitSession) {
      return toSelection(explicitSession.role, explicitSession);
    }
    return toSelection(fallbackRole, null);
  }

  if (hasExplicitRoleParam) {
    return toSelection(roleFromQuery, latestSessionByRole(roleFromQuery));
  }

  if (activeSession) {
    return toSelection(activeSession.role, activeSession);
  }

  if (!selectedTask) {
    return toSelection(fallbackRole, null);
  }

  const defaultRole = resolveAgentStudioDefaultRoleForTask(selectedTask);

  const withRoleFallback = (session: AgentSessionState | null) =>
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
    case "deferred":
    case "closed":
      return withRoleFallback(latestSessionByRole("build") ?? sessionsForTask[0] ?? null);
    default:
      return toSelection(defaultRole ?? fallbackRole, null);
  }
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
  viewActiveSession: AgentSessionState | null;
  activeSession: AgentSessionState | null;
  selectedSessionById: AgentSessionState | null;
  viewSessionsForTask: AgentSessionState[];
  sessionsForTask: AgentSessionState[];
}): AgentSessionState[] => {
  if (!taskId) {
    return [];
  }

  const seenSessionIds = new Set<string>();
  const candidates = [
    viewActiveSession,
    activeSession,
    selectedSessionById,
    ...viewSessionsForTask,
    ...sessionsForTask,
  ];
  const sessions: AgentSessionState[] = [];

  for (const session of candidates) {
    if (!session || session.role !== "build" || session.taskId !== taskId) {
      continue;
    }
    if (seenSessionIds.has(session.sessionId)) {
      continue;
    }
    seenSessionIds.add(session.sessionId);
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
  viewActiveSession: AgentSessionState | null;
  activeSession: AgentSessionState | null;
  selectedSessionById: AgentSessionState | null;
  viewSessionsForTask: AgentSessionState[];
  sessionsForTask: AgentSessionState[];
}): AgentSessionState | null => {
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
