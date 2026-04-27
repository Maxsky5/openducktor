import type { TaskCard } from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentRole,
  AgentRuntimeConnection,
  AgentScenario,
  AgentSessionTodoItem,
  LiveAgentSessionPendingInputBySession,
} from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import { useAgentChatSessionHydration } from "@/components/features/agents/agent-chat/use-agent-chat-session-hydration";
import { useAgentChatSessionRuntimeData } from "@/components/features/agents/agent-chat/use-agent-chat-session-runtime-data";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { useAgentSession } from "@/state/app-state-provider";
import {
  getRuntimeConnectionSupportError,
  runtimeRouteToConnection,
} from "@/state/operations/agent-orchestrator/runtime/runtime";
import {
  SESSION_PENDING_INPUT_STALE_TIME_MS,
  sessionPendingInputQueryKey,
} from "@/state/queries/agent-session-runtime";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { AgentStudioQueryUpdate as QueryUpdate } from "./agent-studio-navigation";
import type { AgentStudioReadinessState } from "./agent-studio-task-hydration-state";
import {
  resolveAgentStudioSessionSelection,
  resolveAgentStudioTaskId,
} from "./agents-page-selection";
import {
  type RuntimeAttachmentSource,
  selectRuntimeAttachmentCandidates,
} from "./use-agent-studio-runtime-attachment-retry";
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
  selectionIntent: {
    taskId: string;
    sessionId: string | null;
    role: AgentRole;
    scenario: AgentScenario | null;
  } | null;
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
  readLiveAgentSessionPendingInput: (
    runtimeKind: NonNullable<AgentSessionState["runtimeKind"]>,
    runtimeConnection: AgentRuntimeConnection,
  ) => Promise<LiveAgentSessionPendingInputBySession>;
  clearComposerInput: () => void;
  onContextSwitchIntent?: () => void;
};

export type AgentStudioSelectionControllerResult = {
  selectedSessionById: AgentSessionSummary | null;
  taskId: string;
  selectedTask: TaskCard | null;
  allSessionSummaries: AgentSessionSummary[];
  sessionsForTask: AgentSessionSummary[];
  activeSessionSummary: AgentSessionSummary | null;
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
  viewActiveSessionSummary: AgentSessionSummary | null;
  viewActiveSession: AgentSessionState | null;
  viewSessionRuntimeDataError?: string | null;
  viewLivePendingInputBySession: LiveAgentSessionPendingInputBySession | null;
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
  selectionIntent,
  updateQuery,
  hydrateRequestedTaskSessionHistory: _hydrateRequestedTaskSessionHistory,
  ensureSessionReadyForView,
  runtimeAttachmentSources,
  refreshRuntimeAttachmentSources,
  readSessionModelCatalog,
  readSessionTodos,
  readLiveAgentSessionPendingInput,
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
  const effectiveSelectionIntent = isRepoNavigationBoundaryPending ? null : selectionIntent;
  const selectedTaskIdParam = effectiveSelectionIntent?.taskId ?? effectiveTaskIdParam;
  const selectedSessionParam = effectiveSelectionIntent?.sessionId ?? effectiveSessionParam;
  const selectedHasExplicitRoleParam =
    effectiveSelectionIntent !== null ? true : effectiveHasExplicitRoleParam;
  const selectedRoleFromQuery = effectiveSelectionIntent?.role ?? effectiveRoleFromQuery;
  const selectedScenarioFromQuery =
    effectiveSelectionIntent?.scenario ?? effectiveScenarioFromQuery;

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
    () => (selectedSessionParam ? (sessionSummariesById.get(selectedSessionParam) ?? null) : null),
    [selectedSessionParam, sessionSummariesById],
  );

  const taskId = resolveAgentStudioTaskId({
    taskIdParam: selectedTaskIdParam,
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
      sessionParam: selectedSessionParam,
      hasExplicitRoleParam: selectedHasExplicitRoleParam,
      roleFromQuery: selectedRoleFromQuery,
      selectedTask,
      fallbackRole: selectedRoleFromQuery,
      scenarioFromQuery: selectedScenarioFromQuery,
    }).activeSession;
  }, [
    selectedHasExplicitRoleParam,
    selectedRoleFromQuery,
    selectedScenarioFromQuery,
    selectedSessionParam,
    selectedTask,
    sessionsForTask,
  ]);
  const activeSession = useAgentSession(activeSessionSummary?.sessionId ?? null);
  const activeSessionRuntimeData = useAgentChatSessionRuntimeData({
    session: activeSession,
    repoReadinessState: agentStudioReadinessState,
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
  const viewSelectionIntent =
    effectiveSelectionIntent && effectiveSelectionIntent.taskId === viewTaskId
      ? effectiveSelectionIntent
      : null;
  const viewHasExplicitRoleSelection = viewSelectionIntent !== null ? true : hasViewRoleSelection;
  const viewRoleFromSelection = viewSelectionIntent?.role ?? effectiveRoleFromQuery;
  const viewScenarioFromSelection = viewSelectionIntent?.scenario ?? effectiveScenarioFromQuery;
  const viewSessionParamFromSelection = viewSelectionIntent?.sessionId ?? viewSessionParam;

  const viewSelection = useMemo(() => {
    return resolveAgentStudioSessionSelection({
      sessionsForTask: viewSessionsForTask,
      sessionParam: viewSessionParamFromSelection,
      hasExplicitRoleParam: viewHasExplicitRoleSelection,
      roleFromQuery: viewRoleFromSelection,
      selectedTask: viewSelectedTask,
      fallbackRole: isViewTaskDetachedFromQuery ? "spec" : viewRoleFromSelection,
      scenarioFromQuery: viewScenarioFromSelection,
    });
  }, [
    viewHasExplicitRoleSelection,
    isViewTaskDetachedFromQuery,
    viewRoleFromSelection,
    viewScenarioFromSelection,
    viewSelectedTask,
    viewSessionParamFromSelection,
    viewSessionsForTask,
  ]);
  const viewActiveSession = useAgentSession(viewSelection.activeSession?.sessionId ?? null);
  const viewSessionRuntimeData = useAgentChatSessionRuntimeData({
    session: viewActiveSession,
    repoReadinessState: agentStudioReadinessState,
    readSessionModelCatalog,
    readSessionTodos,
  });
  const viewLivePendingInputQueryTarget = useMemo(() => {
    const session = viewSessionRuntimeData.session;
    if (!session?.runtimeKind || !session.runtimeRoute) {
      return null;
    }

    const runtimeConnection = runtimeRouteToConnection(
      session.runtimeRoute,
      session.workingDirectory,
    );
    const supportError = getRuntimeConnectionSupportError(
      session.runtimeKind,
      runtimeConnection,
      "live agent session pending input",
    );
    if (supportError) {
      return null;
    }

    return {
      runtimeKind: session.runtimeKind,
      runtimeConnection,
      isActiveSessionWorking: session.status === "starting" || session.status === "running",
    };
  }, [viewSessionRuntimeData.session]);
  const viewLivePendingInputQuery = useQuery<LiveAgentSessionPendingInputBySession>({
    queryKey: viewLivePendingInputQueryTarget
      ? sessionPendingInputQueryKey(
          viewLivePendingInputQueryTarget.runtimeKind,
          viewLivePendingInputQueryTarget.runtimeConnection,
        )
      : (["agent-session-runtime", "pending-input", "disabled", "disabled", "disabled"] as const),
    queryFn: (): Promise<LiveAgentSessionPendingInputBySession> => {
      if (!viewLivePendingInputQueryTarget) {
        return Promise.resolve({});
      }
      return readLiveAgentSessionPendingInput(
        viewLivePendingInputQueryTarget.runtimeKind,
        viewLivePendingInputQueryTarget.runtimeConnection,
      );
    },
    enabled: viewLivePendingInputQueryTarget !== null && agentStudioReadinessState === "ready",
    refetchInterval: viewLivePendingInputQueryTarget?.isActiveSessionWorking ? 2_000 : false,
    staleTime: SESSION_PENDING_INPUT_STALE_TIME_MS,
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
  } = useAgentChatSessionHydration({
    activeWorkspace,
    activeTaskId: viewTaskId,
    activeSession: viewSessionRuntimeData.session,
    repoReadinessState: agentStudioReadinessState,
    ensureSessionReadyForView,
    refreshRuntimeAttachmentSources,
    runtimeAttachmentCandidates,
  });

  return {
    selectedSessionById,
    taskId,
    selectedTask,
    allSessionSummaries: sessions,
    sessionsForTask,
    activeSessionSummary,
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
    viewActiveSessionSummary: viewSelection.activeSession,
    viewActiveSession: viewSessionRuntimeData.session,
    viewSessionRuntimeDataError: viewSessionRuntimeData.runtimeDataError,
    viewLivePendingInputBySession: viewLivePendingInputQuery.data ?? null,
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
