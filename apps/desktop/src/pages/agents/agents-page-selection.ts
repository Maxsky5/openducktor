export {
  isSameSelection,
  normalizeSelectionForCatalog,
  pickDefaultSelectionForCatalog,
} from "../shared/session-start-selection";

import type { AgentModelSelection, AgentRole } from "@openducktor/core";
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
}: {
  sessionsForTask: AgentSessionState[];
  sessionParam: string | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
}): AgentSessionState | null => {
  if (sessionParam) {
    return sessionsForTask.find((entry) => entry.sessionId === sessionParam) ?? null;
  }
  if (hasExplicitRoleParam) {
    return sessionsForTask.find((entry) => entry.role === roleFromQuery) ?? null;
  }
  return sessionsForTask[0] ?? null;
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
