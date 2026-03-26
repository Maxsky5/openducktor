export {
  coerceVisibleSelectionToCatalog,
  isSameSelection,
  pickDefaultVisibleSelectionForCatalog,
} from "@/features/session-start";

import type { TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import { compareAgentSessionRecency } from "@/lib/agent-session-options";
import { buildRoleWorkflowMapForTask } from "@/lib/task-agent-workflows";
import type { AgentSessionState } from "@/types/agent-orchestrator";

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

export const resolveAgentStudioActiveSession = ({
  sessionsForTask,
  sessionParam,
  hasExplicitRoleParam,
  roleFromQuery,
  selectedTask,
}: {
  sessionsForTask: AgentSessionState[];
  sessionParam: string | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
  selectedTask: TaskCard | null;
}): AgentSessionState | null => {
  const activeSession = sessionsForTask.find(
    (session) => session.status === "running" || session.status === "starting",
  );

  const latestSessionByRole = (role: AgentRole): AgentSessionState | null => {
    const roleSessions = sessionsForTask
      .filter((session) => session.role === role)
      .sort(compareAgentSessionRecency);
    return roleSessions[0] ?? null;
  };

  const resolveDefaultRoleForOpenTask = (task: TaskCard): AgentRole | null => {
    const roleWorkflowMap = buildRoleWorkflowMapForTask(task);
    const orderedRoles: AgentRole[] = ["spec", "planner", "build", "qa"];
    for (const role of orderedRoles) {
      const workflow = roleWorkflowMap[role];
      if (workflow.required && workflow.available) {
        return role;
      }
    }
    return null;
  };

  if (sessionParam) {
    return sessionsForTask.find((entry) => entry.sessionId === sessionParam) ?? null;
  }

  if (hasExplicitRoleParam) {
    return sessionsForTask.find((entry) => entry.role === roleFromQuery) ?? null;
  }

  if (activeSession) {
    return activeSession;
  }

  if (!selectedTask) {
    return null;
  }

  switch (selectedTask.status) {
    case "open": {
      const defaultRole = resolveDefaultRoleForOpenTask(selectedTask);
      return defaultRole ? latestSessionByRole(defaultRole) : null;
    }
    case "spec_ready":
      return latestSessionByRole("spec");
    case "ready_for_dev":
      return latestSessionByRole("planner") ?? latestSessionByRole("spec");
    case "in_progress":
    case "ai_review":
    case "human_review":
      return latestSessionByRole("build");
    case "blocked":
    case "deferred":
    case "closed":
      return latestSessionByRole("build") ?? sessionsForTask[0] ?? null;
    default:
      return null;
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
