import type { AgentSessionRecord, RuntimeDescriptor, TaskCard } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentRole, AgentSessionTodoItem } from "@openducktor/core";
import { useMemo } from "react";
import { useAgentChatSessionReadiness } from "@/components/features/agents/agent-chat/use-agent-chat-session-readiness";
import { useAgentChatSessionRuntimeData } from "@/components/features/agents/agent-chat/use-agent-chat-session-runtime-data";
import {
  firstLaunchAction,
  resolveBuildContinuationLaunchAction,
  type SessionLaunchActionId,
} from "@/features/session-start";
import { deriveRepoRuntimeReadiness } from "@/lib/repo-runtime-health";
import type { useChecksState } from "@/state";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { useRuntimeDefinitionsContext } from "@/state/app-state-contexts";
import { useAgentSession } from "@/state/app-state-provider";
import type {
  SessionRepoReadinessState as AgentStudioReadinessState,
  SelectedAgentSessionViewLifecycle,
} from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import type {
  AgentSessionRouteIdentity,
  AgentSessionState,
  EnsureSessionReadyForViewResult,
} from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { AgentStudioQueryUpdate as QueryUpdate } from "./agent-studio-navigation";
import {
  resolveAgentStudioSessionSelection,
  resolveAgentStudioSessionSelectionFromCandidates,
  resolveAgentStudioTaskId,
} from "./agents-page-selection";
import { useAgentStudioTaskTabs } from "./use-agent-studio-task-tabs";

type UseAgentStudioSelectionControllerArgs = {
  activeWorkspace: ActiveWorkspace | null;
  isRepoNavigationBoundaryPending: boolean;
  tasks: TaskCard[];
  isLoadingTasks: boolean;
  sessions: AgentSessionSummary[];
  sessionReadModelError: string | null;
  taskIdParam: string;
  sessionParam: string | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
  selectionIntent: {
    taskId: string;
    externalSessionId: string | null;
    role: AgentRole;
  } | null;
  updateQuery: (updates: QueryUpdate) => void;
  ensureSessionReadyForView: (input: {
    taskId: string;
    externalSessionId: string;
    repoReadinessState: AgentStudioReadinessState;
  }) => Promise<EnsureSessionReadyForViewResult>;
  runtimeDefinitions: RuntimeDescriptor[];
  isLoadingRuntimeDefinitions: ReturnType<
    typeof useRuntimeDefinitionsContext
  >["isLoadingRuntimeDefinitions"];
  runtimeDefinitionsError: ReturnType<
    typeof useRuntimeDefinitionsContext
  >["runtimeDefinitionsError"];
  runtimeHealthByRuntime: ReturnType<typeof useChecksState>["runtimeHealthByRuntime"];
  isLoadingChecks: boolean;
  readSessionModelCatalog: (
    repoPath: string,
    runtimeKind: NonNullable<AgentSessionState["runtimeKind"]>,
  ) => Promise<AgentModelCatalog>;
  readSessionTodos: (
    repoPath: string,
    runtimeKind: NonNullable<AgentSessionState["runtimeKind"]>,
    workingDirectory: string,
    externalSessionId: string,
  ) => Promise<AgentSessionTodoItem[]>;
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
  viewRole: AgentRole;
  viewLaunchActionId: SessionLaunchActionId;
  isActiveTaskReady: boolean;
  isActiveTaskReadinessFailed: boolean;
  viewSessionLifecycle: SelectedAgentSessionViewLifecycle;
};

const ACTIVE_SESSION_STATUS = new Set<AgentSessionState["status"]>(["starting", "running"]);

const compareSessionsByRecency = (
  left: AgentSessionSummary,
  right: AgentSessionSummary,
): number => {
  if (left.startedAt !== right.startedAt) {
    return left.startedAt > right.startedAt ? -1 : 1;
  }
  if (left.externalSessionId === right.externalSessionId) {
    return 0;
  }
  return left.externalSessionId > right.externalSessionId ? -1 : 1;
};

const toSelectedSessionRoute = (session: AgentSessionRouteIdentity): AgentSessionRouteIdentity => ({
  externalSessionId: session.externalSessionId,
  runtimeKind: session.runtimeKind,
  workingDirectory: session.workingDirectory,
});

type ViewSessionSelectionCandidate = AgentSessionRouteIdentity & {
  role: AgentRole | null;
  startedAt: string;
  status?: AgentSessionSummary["status"];
  summary: AgentSessionSummary | null;
};

const toLiveViewSessionCandidate = (
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
  liveSessions: AgentSessionSummary[],
  persistedRecords: AgentSessionRecord[],
): ViewSessionSelectionCandidate[] => {
  const liveSessionIds = new Set(liveSessions.map((session) => session.externalSessionId));
  return [
    ...liveSessions.map(toLiveViewSessionCandidate),
    ...persistedRecords
      .filter((record) => !liveSessionIds.has(record.externalSessionId))
      .map(toPersistedViewSessionCandidate),
  ];
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
    grouped.set(taskId, taskSessions.toSorted(compareSessionsByRecency));
  }

  return grouped;
};

export function useAgentStudioSelectionController({
  activeWorkspace,
  isRepoNavigationBoundaryPending,
  tasks,
  isLoadingTasks,
  sessions,
  sessionReadModelError,
  taskIdParam,
  sessionParam,
  hasExplicitRoleParam,
  roleFromQuery,
  selectionIntent,
  updateQuery,
  ensureSessionReadyForView,
  runtimeDefinitions,
  isLoadingRuntimeDefinitions,
  runtimeDefinitionsError,
  runtimeHealthByRuntime,
  isLoadingChecks,
  readSessionModelCatalog,
  readSessionTodos,
  clearComposerInput,
  onContextSwitchIntent,
}: UseAgentStudioSelectionControllerArgs): AgentStudioSelectionControllerResult {
  const effectiveTaskIdParam = isRepoNavigationBoundaryPending ? "" : taskIdParam;
  const effectiveSessionParam = isRepoNavigationBoundaryPending ? null : sessionParam;
  const effectiveHasExplicitRoleParam = isRepoNavigationBoundaryPending
    ? false
    : hasExplicitRoleParam;
  const effectiveRoleFromQuery: AgentRole = isRepoNavigationBoundaryPending
    ? "spec"
    : roleFromQuery;
  const effectiveSelectionIntent = isRepoNavigationBoundaryPending ? null : selectionIntent;
  const selectedTaskIdParam = effectiveSelectionIntent?.taskId ?? effectiveTaskIdParam;
  const selectedSessionParam = effectiveSelectionIntent?.externalSessionId ?? effectiveSessionParam;
  const selectedHasExplicitRoleParam =
    effectiveSelectionIntent !== null ? true : effectiveHasExplicitRoleParam;
  const selectedRoleFromQuery = effectiveSelectionIntent?.role ?? effectiveRoleFromQuery;
  const keepSelectedExplicitRoleSessionless =
    effectiveSelectionIntent?.externalSessionId === null && effectiveSessionParam === null;

  const tasksById = useMemo(() => {
    return new Map(tasks.map((task) => [task.id, task]));
  }, [tasks]);

  const sessionSummariesById = useMemo(() => {
    return new Map(sessions.map((session) => [session.externalSessionId, session]));
  }, [sessions]);

  const sessionsByTaskId = useMemo(() => groupSessionsByTaskId(sessions), [sessions]);

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
      keepExplicitRoleSessionless: keepSelectedExplicitRoleSessionless,
    }).activeSession;
  }, [
    keepSelectedExplicitRoleSessionless,
    selectedHasExplicitRoleParam,
    selectedRoleFromQuery,
    selectedSessionParam,
    selectedTask,
    sessionsForTask,
  ]);
  const activeSession = useAgentSession(activeSessionSummary?.externalSessionId ?? null);

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
      let activeSession: AgentSessionSummary | null = null;
      for (const session of taskSessions) {
        if (ACTIVE_SESSION_STATUS.has(session.status)) {
          activeSession = session;
          break;
        }
      }
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

    const belongsToSummarizedViewTask = viewSessionsForTask.some(
      (session) => session.externalSessionId === effectiveSessionParam,
    );
    const belongsToPersistedViewTask = (viewSelectedTask?.agentSessions ?? []).some(
      (record) => record.externalSessionId === effectiveSessionParam,
    );
    return belongsToSummarizedViewTask || belongsToPersistedViewTask ? effectiveSessionParam : null;
  }, [effectiveSessionParam, viewSelectedTask?.agentSessions, viewSessionsForTask]);

  const isViewTaskDetachedFromQuery = Boolean(viewTaskId && taskId && viewTaskId !== taskId);
  const hasViewRoleSelection = effectiveHasExplicitRoleParam && !isViewTaskDetachedFromQuery;
  const viewSelectionIntent =
    effectiveSelectionIntent && effectiveSelectionIntent.taskId === viewTaskId
      ? effectiveSelectionIntent
      : null;
  const viewHasExplicitRoleSelection = viewSelectionIntent !== null ? true : hasViewRoleSelection;
  const viewRoleFromSelection = viewSelectionIntent?.role ?? effectiveRoleFromQuery;
  const viewSessionParamFromSelection = viewSelectionIntent?.externalSessionId ?? viewSessionParam;
  const keepViewExplicitRoleSessionless =
    viewSelectionIntent?.externalSessionId === null && viewSessionParam === null;

  const viewSessionSelectionCandidates = useMemo(
    () =>
      buildViewSessionSelectionCandidates(
        viewSessionsForTask,
        viewSelectedTask?.agentSessions ?? [],
      ),
    [viewSelectedTask?.agentSessions, viewSessionsForTask],
  );
  const viewSelection = useMemo(() => {
    return resolveAgentStudioSessionSelectionFromCandidates({
      sessionsForTask: viewSessionSelectionCandidates,
      sessionParam: viewSessionParamFromSelection,
      hasExplicitRoleParam: viewHasExplicitRoleSelection,
      roleFromQuery: viewRoleFromSelection,
      selectedTask: viewSelectedTask,
      fallbackRole: isViewTaskDetachedFromQuery ? "spec" : viewRoleFromSelection,
      keepExplicitRoleSessionless: keepViewExplicitRoleSessionless,
    });
  }, [
    viewHasExplicitRoleSelection,
    isViewTaskDetachedFromQuery,
    keepViewExplicitRoleSessionless,
    viewRoleFromSelection,
    viewSelectedTask,
    viewSessionParamFromSelection,
    viewSessionSelectionCandidates,
  ]);
  const viewSelectedSessionRoute = useMemo(() => {
    return viewSelection.activeSession ? toSelectedSessionRoute(viewSelection.activeSession) : null;
  }, [viewSelection.activeSession]);
  const viewActiveSession = useAgentSession(viewSelectedSessionRoute?.externalSessionId ?? null);
  const activeSessionReadinessState = useMemo(
    () =>
      deriveRepoRuntimeReadiness({
        hasActiveWorkspace: activeWorkspace !== null,
        runtimeDefinitions,
        isLoadingRuntimeDefinitions,
        runtimeDefinitionsError,
        runtimeHealthByRuntime,
        isLoadingChecks,
        runtimeKind: activeSession?.runtimeKind ?? activeSessionSummary?.runtimeKind ?? null,
      }).readinessState,
    [
      activeSession?.runtimeKind,
      activeSessionSummary?.runtimeKind,
      activeWorkspace,
      isLoadingChecks,
      isLoadingRuntimeDefinitions,
      runtimeDefinitions,
      runtimeDefinitionsError,
      runtimeHealthByRuntime,
    ],
  );
  const viewSessionReadinessState = useMemo(
    () =>
      deriveRepoRuntimeReadiness({
        hasActiveWorkspace: activeWorkspace !== null,
        runtimeDefinitions,
        isLoadingRuntimeDefinitions,
        runtimeDefinitionsError,
        runtimeHealthByRuntime,
        isLoadingChecks,
        runtimeKind: viewSelectedSessionRoute?.runtimeKind ?? null,
      }).readinessState,
    [
      activeWorkspace,
      isLoadingChecks,
      isLoadingRuntimeDefinitions,
      runtimeDefinitions,
      runtimeDefinitionsError,
      runtimeHealthByRuntime,
      viewSelectedSessionRoute?.runtimeKind,
    ],
  );
  const isActiveSessionSameAsViewSession =
    activeSession !== null &&
    viewActiveSession !== null &&
    activeSession.externalSessionId === viewActiveSession.externalSessionId;
  const activeSessionRuntimeDataForDistinctSession = useAgentChatSessionRuntimeData({
    session: isActiveSessionSameAsViewSession ? null : activeSession,
    runtimeDefinitions,
    repoReadinessState: activeSessionReadinessState,
    readSessionModelCatalog,
    readSessionTodos,
  });
  const viewSessionRuntimeData = useAgentChatSessionRuntimeData({
    session: viewActiveSession,
    runtimeDefinitions,
    repoReadinessState: viewSessionReadinessState,
    readSessionModelCatalog,
    readSessionTodos,
  });
  const activeSessionRuntimeData = isActiveSessionSameAsViewSession
    ? viewSessionRuntimeData
    : activeSessionRuntimeDataForDistinctSession;
  const viewRole = viewSelection.role;
  const viewLaunchActionId: SessionLaunchActionId =
    viewRole === "build"
      ? resolveBuildContinuationLaunchAction(viewSelectedTask)
      : firstLaunchAction(viewRole);
  const { isActiveTaskReady, isActiveTaskReadinessFailed, selectedSessionLifecycle } =
    useAgentChatSessionReadiness({
      activeWorkspace,
      activeTaskId: viewTaskId,
      selectedSessionRoute: viewSelectedSessionRoute,
      activeSession: viewSessionRuntimeData.session,
      repoReadinessState: viewSessionReadinessState,
      sessionLoadError: sessionReadModelError,
      ensureSessionReadyForView,
    });

  return useMemo<AgentStudioSelectionControllerResult>(
    () => ({
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
      viewActiveSessionSummary: viewSelection.activeSession?.summary ?? null,
      viewActiveSession: viewSessionRuntimeData.session,
      viewSessionRuntimeDataError: viewSessionRuntimeData.runtimeDataError,
      viewRole,
      viewLaunchActionId,
      isActiveTaskReady,
      isActiveTaskReadinessFailed,
      viewSessionLifecycle: selectedSessionLifecycle,
    }),
    [
      activeSessionRuntimeData.runtimeDataError,
      activeSessionRuntimeData.session,
      activeSessionSummary,
      activeTaskTabId,
      availableTabTasks,
      handleCloseTab,
      handleCreateTab,
      handleReorderTab,
      handleSelectTab,
      isActiveTaskReady,
      isActiveTaskReadinessFailed,
      isLoadingTasks,
      selectedSessionLifecycle,
      selectedSessionById,
      selectedTask,
      sessions,
      sessionsForTask,
      taskId,
      taskTabs,
      viewLaunchActionId,
      viewRole,
      viewSelectedTask,
      viewSelection.activeSession,
      viewSessionRuntimeData.runtimeDataError,
      viewSessionRuntimeData.session,
      viewSessionsForTask,
      viewTaskId,
    ],
  );
}
