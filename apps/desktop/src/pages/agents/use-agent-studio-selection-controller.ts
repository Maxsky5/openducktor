import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario } from "@openducktor/core";
import { useMemo, useRef } from "react";
import type { AgentSessionLoadOptions, AgentSessionState } from "@/types/agent-orchestrator";
import { firstScenario, SCENARIOS_BY_ROLE } from "./agents-page-constants";
import { resolveAgentStudioActiveSession, resolveAgentStudioTaskId } from "./agents-page-selection";
import { useAgentStudioTaskHydration } from "./use-agent-studio-task-hydration";
import { useAgentStudioTaskTabs } from "./use-agent-studio-task-tabs";

type QueryUpdate = Record<string, string | undefined>;

type UseAgentStudioSelectionControllerArgs = {
  activeRepo: string | null;
  tasks: TaskCard[];
  isLoadingTasks: boolean;
  sessions: AgentSessionState[];
  taskIdParam: string;
  sessionParam: string | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
  updateQuery: (updates: QueryUpdate) => void;
  loadAgentSessions: (taskId: string, options?: AgentSessionLoadOptions) => Promise<void>;
  clearComposerInput: () => void;
  onContextSwitchIntent?: () => void;
};

type UseAgentStudioSelectionControllerResult = {
  selectedSessionById: AgentSessionState | null;
  taskId: string;
  selectedTask: TaskCard | null;
  sessionsForTask: AgentSessionState[];
  activeSession: AgentSessionState | null;
  activeTaskTabId: string;
  availableTabTasks: TaskCard[];
  taskTabs: ReturnType<typeof useAgentStudioTaskTabs>["taskTabs"];
  handleSelectTab: (nextTaskId: string) => void;
  handleCreateTab: (nextTaskId: string) => void;
  handleCloseTab: (taskIdToClose: string) => void;
  viewTaskId: string;
  viewSelectedTask: TaskCard | null;
  viewSessionsForTask: AgentSessionState[];
  viewActiveSession: AgentSessionState | null;
  viewRole: AgentRole;
  viewScenario: AgentScenario;
  isActiveTaskHydrated: boolean;
};

const compareSessionsByRecency = (left: AgentSessionState, right: AgentSessionState): number => {
  if (left.startedAt !== right.startedAt) {
    return left.startedAt > right.startedAt ? -1 : 1;
  }
  if (left.sessionId === right.sessionId) {
    return 0;
  }
  return left.sessionId > right.sessionId ? -1 : 1;
};

type SessionsByTaskSortCacheEntry = {
  inputSignature: string;
  sortedSessionIds: string[];
};

type SessionsByTaskSortCache = Map<string, SessionsByTaskSortCacheEntry>;

const toTaskInputSignature = (taskSessions: AgentSessionState[]): string =>
  taskSessions
    .map((session) => `${session.sessionId}:${session.startedAt}`)
    .sort()
    .join("|");

export const buildSessionsByTaskIdWithCache = (
  sessions: AgentSessionState[],
  previousCache: SessionsByTaskSortCache,
): { sessionsByTaskId: Map<string, AgentSessionState[]>; nextCache: SessionsByTaskSortCache } => {
  const grouped = new Map<string, AgentSessionState[]>();
  for (const session of sessions) {
    const current = grouped.get(session.taskId);
    if (current) {
      current.push(session);
    } else {
      grouped.set(session.taskId, [session]);
    }
  }

  const nextCache: SessionsByTaskSortCache = new Map();
  for (const [taskId, taskSessions] of grouped) {
    const inputSignature = toTaskInputSignature(taskSessions);
    const previous = previousCache.get(taskId);
    const sessionsById = new Map(taskSessions.map((session) => [session.sessionId, session]));

    let sortedSessions: AgentSessionState[];
    if (previous && previous.inputSignature === inputSignature) {
      sortedSessions = previous.sortedSessionIds
        .map((sessionId) => sessionsById.get(sessionId))
        .filter((session): session is AgentSessionState => session !== undefined);

      if (sortedSessions.length !== taskSessions.length) {
        sortedSessions = [...taskSessions].sort(compareSessionsByRecency);
      }
    } else {
      sortedSessions = [...taskSessions].sort(compareSessionsByRecency);
    }

    grouped.set(taskId, sortedSessions);
    nextCache.set(taskId, {
      inputSignature,
      sortedSessionIds: sortedSessions.map((session) => session.sessionId),
    });
  }

  return {
    sessionsByTaskId: grouped,
    nextCache,
  };
};

export function useAgentStudioSelectionController({
  activeRepo,
  tasks,
  isLoadingTasks,
  sessions,
  taskIdParam,
  sessionParam,
  hasExplicitRoleParam,
  roleFromQuery,
  updateQuery,
  loadAgentSessions,
  clearComposerInput,
  onContextSwitchIntent,
}: UseAgentStudioSelectionControllerArgs): UseAgentStudioSelectionControllerResult {
  const sessionsByTaskSortCacheRef = useRef<SessionsByTaskSortCache>(new Map());

  const tasksById = useMemo(() => {
    return new Map(tasks.map((task) => [task.id, task]));
  }, [tasks]);

  const sessionsById = useMemo(() => {
    return new Map(sessions.map((session) => [session.sessionId, session]));
  }, [sessions]);

  const sessionsByTaskId = useMemo(() => {
    const { sessionsByTaskId: grouped, nextCache } = buildSessionsByTaskIdWithCache(
      sessions,
      sessionsByTaskSortCacheRef.current,
    );
    sessionsByTaskSortCacheRef.current = nextCache;
    return grouped;
  }, [sessions]);

  const selectedSessionById = useMemo(
    () => (sessionParam ? (sessionsById.get(sessionParam) ?? null) : null),
    [sessionParam, sessionsById],
  );

  const taskId = resolveAgentStudioTaskId({
    taskIdParam,
    selectedSessionById,
  });

  const selectedTask = useMemo(
    () => (taskId ? (tasksById.get(taskId) ?? null) : null),
    [taskId, tasksById],
  );

  const sessionsForTask = useMemo(() => {
    if (!taskId) {
      return [];
    }
    return sessionsByTaskId.get(taskId) ?? [];
  }, [sessionsByTaskId, taskId]);

  const activeSession = useMemo(() => {
    return resolveAgentStudioActiveSession({
      sessionsForTask,
      sessionParam,
      hasExplicitRoleParam,
      roleFromQuery,
    });
  }, [hasExplicitRoleParam, roleFromQuery, sessionParam, sessionsForTask]);

  const latestSessionByTaskId = useMemo(() => {
    const latestByTask = new Map<string, AgentSessionState>();
    for (const [taskKey, taskSessions] of sessionsByTaskId) {
      const latestSession = taskSessions[0];
      if (latestSession) {
        latestByTask.set(taskKey, latestSession);
      }
    }
    return latestByTask;
  }, [sessionsByTaskId]);

  const {
    activeTaskTabId,
    availableTabTasks,
    taskTabs,
    handleSelectTab,
    handleCreateTab,
    handleCloseTab,
  } = useAgentStudioTaskTabs({
    activeRepo,
    taskId,
    selectedTask,
    tasks,
    isLoadingTasks,
    latestSessionByTaskId,
    updateQuery,
    clearComposerInput,
    ...(onContextSwitchIntent ? { onContextSwitchIntent } : {}),
  });

  const viewTaskId = activeTaskTabId || taskId;

  const viewSelectedTask = useMemo(
    () => (viewTaskId ? (tasksById.get(viewTaskId) ?? null) : null),
    [tasksById, viewTaskId],
  );

  const viewSessionsForTask = useMemo(() => {
    if (!viewTaskId) {
      return [];
    }
    return sessionsByTaskId.get(viewTaskId) ?? [];
  }, [sessionsByTaskId, viewTaskId]);

  const viewSessionParam = useMemo(() => {
    if (!sessionParam) {
      return null;
    }

    const belongsToViewTask = viewSessionsForTask.some(
      (session) => session.sessionId === sessionParam,
    );
    return belongsToViewTask ? sessionParam : null;
  }, [sessionParam, viewSessionsForTask]);

  const isViewTaskDetachedFromQuery = Boolean(viewTaskId && taskId && viewTaskId !== taskId);
  const hasViewRoleSelection = hasExplicitRoleParam && !isViewTaskDetachedFromQuery;

  const viewActiveSession = useMemo(() => {
    return resolveAgentStudioActiveSession({
      sessionsForTask: viewSessionsForTask,
      sessionParam: viewSessionParam,
      hasExplicitRoleParam: hasViewRoleSelection,
      roleFromQuery,
    });
  }, [
    hasViewRoleSelection,
    roleFromQuery,
    viewSessionParam,
    viewSessionsForTask,
  ]);

  const viewRole: AgentRole = hasViewRoleSelection
    ? roleFromQuery
    : (viewActiveSession?.role ??
      viewSessionsForTask[0]?.role ??
      (isViewTaskDetachedFromQuery ? "spec" : roleFromQuery));

  const viewScenarios = SCENARIOS_BY_ROLE[viewRole];

  const viewScenario: AgentScenario =
    viewActiveSession?.scenario && viewScenarios.includes(viewActiveSession.scenario)
      ? viewActiveSession.scenario
      : firstScenario(viewRole);

  const hydratedTasksByRepoAndTask = useAgentStudioTaskHydration({
    activeRepo,
    activeTaskId: viewTaskId,
    activeSessionId: viewActiveSession?.sessionId ?? null,
    loadAgentSessions,
  });

  const taskHydrationKey = activeRepo && viewTaskId ? `${activeRepo}:${viewTaskId}` : "";
  const isActiveTaskHydrated = taskHydrationKey
    ? (hydratedTasksByRepoAndTask[taskHydrationKey] ?? false)
    : false;

  return {
    selectedSessionById,
    taskId,
    selectedTask,
    sessionsForTask,
    activeSession,
    activeTaskTabId,
    availableTabTasks,
    taskTabs,
    handleSelectTab,
    handleCreateTab,
    handleCloseTab,
    viewTaskId,
    viewSelectedTask,
    viewSessionsForTask,
    viewActiveSession,
    viewRole,
    viewScenario,
    isActiveTaskHydrated,
  };
}
