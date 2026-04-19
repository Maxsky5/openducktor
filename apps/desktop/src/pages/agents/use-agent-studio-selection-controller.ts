import type { TaskCard } from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentRole,
  AgentRuntimeConnection,
  AgentScenario,
  AgentSessionTodoItem,
} from "@openducktor/core";
import { useMemo, useRef } from "react";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { useAgentSession } from "@/state/app-state-provider";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { AgentStudioQueryUpdate as QueryUpdate } from "./agent-studio-navigation";
import type { AgentStudioReadinessState } from "./agent-studio-task-hydration-state";
import {
  resolveAgentStudioSessionSelection,
  resolveAgentStudioTaskId,
} from "./agents-page-selection";
import { useAgentStudioActiveSessionRuntimeData } from "./use-agent-studio-active-session-runtime-data";
import {
  type RuntimeAttachmentSource,
  selectRuntimeAttachmentCandidates,
} from "./use-agent-studio-runtime-attachment-retry";
import { useAgentStudioTaskHydration } from "./use-agent-studio-task-hydration";
import { useAgentStudioTaskTabs } from "./use-agent-studio-task-tabs";

type UseAgentStudioSelectionControllerArgs = {
  activeWorkspace: ActiveWorkspace | null;
  isRepoNavigationBoundaryPending: boolean;
  agentStudioReadinessState: AgentStudioReadinessState;
  tasks: TaskCard[];
  isLoadingTasks: boolean;
  sessions: AgentSessionSummary[];
  taskIdParam: string;
  sessionParam: string | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
  scenarioFromQuery: AgentScenario | null;
  updateQuery: (updates: QueryUpdate) => void;
  hydrateRequestedTaskSessionHistory: (input: {
    taskId: string;
    sessionId: string;
  }) => Promise<void>;
  ensureSessionReadyForView: (input: {
    taskId: string;
    sessionId: string;
    repoReadinessState: AgentStudioReadinessState;
    recoveryDedupKey?: string | null;
  }) => Promise<boolean>;
  runtimeAttachmentSources: RuntimeAttachmentSource[];
  refreshRuntimeAttachmentSources: () => Promise<void>;
  readSessionModelCatalog: (
    runtimeKind: NonNullable<AgentSessionState["runtimeKind"]>,
    runtimeConnection: AgentRuntimeConnection,
  ) => Promise<AgentModelCatalog>;
  readSessionTodos: (
    runtimeKind: NonNullable<AgentSessionState["runtimeKind"]>,
    runtimeConnection: AgentRuntimeConnection,
    externalSessionId: string,
  ) => Promise<AgentSessionTodoItem[]>;
  clearComposerInput: () => void;
  onContextSwitchIntent?: () => void;
};

export type AgentStudioSelectionControllerResult = {
  selectedSessionById: AgentSessionSummary | null;
  taskId: string;
  selectedTask: TaskCard | null;
  sessionsForTask: AgentSessionSummary[];
  activeSession: AgentSessionState | null;
  activeSessionRuntimeDataError?: string | null;
  isLoadingTasks: boolean;
  activeTaskTabId: string;
  availableTabTasks: TaskCard[];
  taskTabs: ReturnType<typeof useAgentStudioTaskTabs>["taskTabs"];
  handleSelectTab: (nextTaskId: string) => void;
  handleCreateTab: (nextTaskId: string) => void;
  handleCloseTab: (taskIdToClose: string) => void;
  handleReorderTab: (
    draggedTaskId: string,
    targetTaskId: string,
    position: "before" | "after",
  ) => void;
  viewTaskId: string;
  viewSelectedTask: TaskCard | null;
  viewSessionsForTask: AgentSessionSummary[];
  viewActiveSession: AgentSessionState | null;
  viewSessionRuntimeDataError?: string | null;
  viewRole: AgentRole;
  viewScenario: AgentScenario;
  isActiveTaskHydrated: boolean;
  isActiveTaskHydrationFailed: boolean;
  isViewSessionHistoryHydrated: boolean;
  isViewSessionHistoryHydrationFailed: boolean;
  isViewSessionHistoryHydrating: boolean;
  isViewSessionWaitingForRuntimeReadiness: boolean;
};

const ACTIVE_SESSION_STATUS = new Set<AgentSessionState["status"]>(["starting", "running"]);

const compareSessionsByRecency = (
  left: AgentSessionSummary,
  right: AgentSessionSummary,
): number => {
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

const toTaskInputSignature = (taskSessions: AgentSessionSummary[]): string =>
  taskSessions
    .map((session) => `${session.sessionId}:${session.startedAt}`)
    .sort()
    .join("|");

export const buildSessionsByTaskIdWithCache = (
  sessions: AgentSessionSummary[],
  previousCache: SessionsByTaskSortCache,
): { sessionsByTaskId: Map<string, AgentSessionSummary[]>; nextCache: SessionsByTaskSortCache } => {
  const grouped = new Map<string, AgentSessionSummary[]>();
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

    let sortedSessions: AgentSessionSummary[];
    if (previous && previous.inputSignature === inputSignature) {
      sortedSessions = previous.sortedSessionIds
        .map((sessionId) => sessionsById.get(sessionId))
        .filter((session): session is AgentSessionSummary => session !== undefined);

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
  activeWorkspace,
  isRepoNavigationBoundaryPending,
  agentStudioReadinessState,
  tasks,
  isLoadingTasks,
  sessions,
  taskIdParam,
  sessionParam,
  hasExplicitRoleParam,
  roleFromQuery,
  scenarioFromQuery,
  updateQuery,
  hydrateRequestedTaskSessionHistory: _hydrateRequestedTaskSessionHistory,
  ensureSessionReadyForView,
  runtimeAttachmentSources,
  refreshRuntimeAttachmentSources,
  readSessionModelCatalog,
  readSessionTodos,
  clearComposerInput,
  onContextSwitchIntent,
}: UseAgentStudioSelectionControllerArgs): AgentStudioSelectionControllerResult {
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const sessionsByTaskSortCacheRef = useRef<SessionsByTaskSortCache>(new Map());
  const effectiveTaskIdParam = isRepoNavigationBoundaryPending ? "" : taskIdParam;
  const effectiveSessionParam = isRepoNavigationBoundaryPending ? null : sessionParam;
  const effectiveHasExplicitRoleParam = isRepoNavigationBoundaryPending
    ? false
    : hasExplicitRoleParam;
  const effectiveRoleFromQuery: AgentRole = isRepoNavigationBoundaryPending
    ? "spec"
    : roleFromQuery;
  const effectiveScenarioFromQuery = isRepoNavigationBoundaryPending ? null : scenarioFromQuery;

  const tasksById = useMemo(() => {
    return new Map(tasks.map((task) => [task.id, task]));
  }, [tasks]);

  const sessionSummariesById = useMemo(() => {
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
    () =>
      effectiveSessionParam ? (sessionSummariesById.get(effectiveSessionParam) ?? null) : null,
    [effectiveSessionParam, sessionSummariesById],
  );

  const taskId = resolveAgentStudioTaskId({
    taskIdParam: effectiveTaskIdParam,
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

  const activeSessionSummary = useMemo(() => {
    return resolveAgentStudioSessionSelection({
      sessionsForTask,
      sessionParam: effectiveSessionParam,
      hasExplicitRoleParam: effectiveHasExplicitRoleParam,
      roleFromQuery: effectiveRoleFromQuery,
      selectedTask,
      fallbackRole: effectiveRoleFromQuery,
      scenarioFromQuery: effectiveScenarioFromQuery,
    }).activeSession;
  }, [
    effectiveHasExplicitRoleParam,
    effectiveRoleFromQuery,
    effectiveScenarioFromQuery,
    effectiveSessionParam,
    selectedTask,
    sessionsForTask,
  ]);
  const activeSession = useAgentSession(activeSessionSummary?.sessionId ?? null);
  const activeSessionRuntimeData = useAgentStudioActiveSessionRuntimeData({
    session: activeSession,
    agentStudioReadinessState,
    readSessionModelCatalog,
    readSessionTodos,
  });

  const latestSessionByTaskId = useMemo(() => {
    const latestByTask = new Map<string, AgentSessionSummary>();
    for (const [taskKey, taskSessions] of sessionsByTaskId) {
      const latestSession = taskSessions[0];
      if (latestSession) {
        latestByTask.set(taskKey, latestSession);
      }
    }
    return latestByTask;
  }, [sessionsByTaskId]);

  const activeSessionByTaskId = useMemo(() => {
    const activeByTask = new Map<string, AgentSessionSummary>();
    for (const [taskKey, taskSessions] of sessionsByTaskId) {
      const activeSession = taskSessions.find((session) =>
        ACTIVE_SESSION_STATUS.has(session.status),
      );
      if (activeSession) {
        activeByTask.set(taskKey, activeSession);
      }
    }
    return activeByTask;
  }, [sessionsByTaskId]);

  const {
    activeTaskTabId,
    availableTabTasks,
    taskTabs,
    handleSelectTab,
    handleCreateTab,
    handleCloseTab,
    handleReorderTab,
  } = useAgentStudioTaskTabs({
    activeWorkspace,
    isRepoNavigationBoundaryPending,
    taskId,
    selectedTask,
    tasks,
    isLoadingTasks,
    latestSessionByTaskId,
    activeSessionByTaskId,
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
    if (!effectiveSessionParam) {
      return null;
    }

    const belongsToViewTask = viewSessionsForTask.some(
      (session) => session.sessionId === effectiveSessionParam,
    );
    return belongsToViewTask ? effectiveSessionParam : null;
  }, [effectiveSessionParam, viewSessionsForTask]);

  const isViewTaskDetachedFromQuery = Boolean(viewTaskId && taskId && viewTaskId !== taskId);
  const hasViewRoleSelection = effectiveHasExplicitRoleParam && !isViewTaskDetachedFromQuery;

  const viewSelection = useMemo(() => {
    return resolveAgentStudioSessionSelection({
      sessionsForTask: viewSessionsForTask,
      sessionParam: viewSessionParam,
      hasExplicitRoleParam: hasViewRoleSelection,
      roleFromQuery: effectiveRoleFromQuery,
      selectedTask: viewSelectedTask,
      fallbackRole: isViewTaskDetachedFromQuery ? "spec" : effectiveRoleFromQuery,
      scenarioFromQuery: effectiveScenarioFromQuery,
    });
  }, [
    hasViewRoleSelection,
    isViewTaskDetachedFromQuery,
    effectiveRoleFromQuery,
    effectiveScenarioFromQuery,
    viewSelectedTask,
    viewSessionParam,
    viewSessionsForTask,
  ]);
  const viewActiveSession = useAgentSession(viewSelection.activeSession?.sessionId ?? null);
  const viewSessionRuntimeData = useAgentStudioActiveSessionRuntimeData({
    session: viewActiveSession,
    agentStudioReadinessState,
    readSessionModelCatalog,
    readSessionTodos,
  });
  const viewRole = viewSelection.role;
  const viewScenario = viewSelection.scenario;
  const runtimeAttachmentCandidates = useMemo(
    () =>
      selectRuntimeAttachmentCandidates({
        repoPath: workspaceRepoPath ?? "",
        session: viewSessionRuntimeData.session,
        runtimeSources: runtimeAttachmentSources,
      }),
    [workspaceRepoPath, viewSessionRuntimeData.session, runtimeAttachmentSources],
  );

  const {
    isActiveTaskHydrated,
    isActiveTaskHydrationFailed,
    isActiveSessionHistoryHydrated,
    isActiveSessionHistoryHydrationFailed,
    isActiveSessionHistoryHydrating,
    isWaitingForRuntimeReadiness,
  } = useAgentStudioTaskHydration({
    activeWorkspace,
    activeTaskId: viewTaskId,
    activeSession: viewSessionRuntimeData.session,
    agentStudioReadinessState,
    ensureSessionReadyForView,
    refreshRuntimeAttachmentSources,
    runtimeAttachmentCandidates,
  });

  return {
    selectedSessionById,
    taskId,
    selectedTask,
    sessionsForTask,
    activeSession: activeSessionRuntimeData.session,
    activeSessionRuntimeDataError: activeSessionRuntimeData.runtimeDataError,
    isLoadingTasks,
    activeTaskTabId,
    availableTabTasks,
    taskTabs,
    handleSelectTab,
    handleCreateTab,
    handleCloseTab,
    handleReorderTab,
    viewTaskId,
    viewSelectedTask,
    viewSessionsForTask,
    viewActiveSession: viewSessionRuntimeData.session,
    viewSessionRuntimeDataError: viewSessionRuntimeData.runtimeDataError,
    viewRole,
    viewScenario,
    isActiveTaskHydrated,
    isActiveTaskHydrationFailed,
    isViewSessionHistoryHydrated: isActiveSessionHistoryHydrated,
    isViewSessionHistoryHydrationFailed: isActiveSessionHistoryHydrationFailed,
    isViewSessionHistoryHydrating: isActiveSessionHistoryHydrating,
    isViewSessionWaitingForRuntimeReadiness: isWaitingForRuntimeReadiness,
  };
}
