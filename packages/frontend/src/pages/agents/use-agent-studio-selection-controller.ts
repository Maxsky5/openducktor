import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useMemo } from "react";
import { isAgentSessionActivityActive } from "@/lib/agent-session-activity-state";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { useSelectedSessionHistoryLoad } from "@/state/operations/agent-orchestrator/history/use-selected-session-history-load";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  findAgentStudioSessionSummaryByKey,
  groupSessionsByTaskId,
  resolveAgentStudioSessionSelection,
  resolveAgentStudioTaskId,
} from "./agents-page-selection";
import {
  type AgentStudioSelectedSessionView,
  useAgentStudioSelectedSessionView,
} from "./selected-session/use-agent-studio-selected-session-view";
import {
  type AgentStudioSelectionState,
  agentStudioSelectionSessionKey,
  type SelectAgentStudioSelection,
} from "./shell/agent-studio-selection-state";
import { useAgentStudioTaskTabs } from "./use-agent-studio-task-tabs";

type UseAgentStudioSelectionControllerArgs = {
  activeWorkspaceId: string | null;
  workspaceRepoPath: string | null;
  isRepoNavigationBoundaryPending: boolean;
  tasks: TaskCard[];
  isLoadingTasks: boolean;
  sessions: AgentSessionSummary[];
  taskIdParam: string;
  sessionKeyParam: string | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
  selectionState: AgentStudioSelectionState;
  repoSettings: RepoSettingsInput | null;
  isLoadingRepoSettings: boolean;
  selectAgentStudioSelection: SelectAgentStudioSelection;
};

export type AgentStudioSelectedView = {
  taskId: string;
  selectedTask: TaskCard | null;
  sessionsForTask: AgentSessionSummary[];
  isTaskReady: boolean;
} & AgentStudioSelectedSessionView;

export type AgentStudioSelectionControllerResult = {
  selectedSessionFromRoute: AgentSessionSummary | null;
  taskId: string;
  selectedTask: TaskCard | null;
  allSessionSummaries: AgentSessionSummary[];
  sessionsForTask: AgentSessionSummary[];
  resolvedRouteSession: AgentSessionSummary | null;
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
  view: AgentStudioSelectedView;
};

export function useAgentStudioSelectionController({
  activeWorkspaceId,
  workspaceRepoPath,
  isRepoNavigationBoundaryPending,
  tasks,
  isLoadingTasks,
  sessions,
  taskIdParam,
  sessionKeyParam,
  hasExplicitRoleParam,
  roleFromQuery,
  selectionState,
  repoSettings,
  isLoadingRepoSettings,
  selectAgentStudioSelection,
}: UseAgentStudioSelectionControllerArgs): AgentStudioSelectionControllerResult {
  const tasksById = useMemo(() => {
    return new Map(tasks.map((task) => [task.id, task]));
  }, [tasks]);

  const sessionsByTaskId = useMemo(() => groupSessionsByTaskId(sessions), [sessions]);

  const selectedSessionFromRoute = useMemo(
    () =>
      isRepoNavigationBoundaryPending
        ? null
        : findAgentStudioSessionSummaryByKey(sessions, sessionKeyParam),
    [isRepoNavigationBoundaryPending, sessionKeyParam, sessions],
  );
  const selectedSessionFromSelection = useMemo(
    () =>
      findAgentStudioSessionSummaryByKey(sessions, agentStudioSelectionSessionKey(selectionState)),
    [selectionState, sessions],
  );

  const taskId = resolveAgentStudioTaskId({
    taskIdParam: selectionState.taskId,
    selectedSessionFromRoute: selectedSessionFromSelection,
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

  const resolvedRouteSession = useMemo(() => {
    if (isRepoNavigationBoundaryPending) {
      return null;
    }
    const routeTaskId = resolveAgentStudioTaskId({
      taskIdParam,
      selectedSessionFromRoute,
    });
    const routeSelectedTask = routeTaskId ? (tasksById.get(routeTaskId) ?? null) : null;
    const routeSessionsForTask = routeTaskId ? (sessionsByTaskId.get(routeTaskId) ?? []) : [];
    return resolveAgentStudioSessionSelection({
      sessionsForTask: routeSessionsForTask,
      sessionKey: sessionKeyParam,
      hasExplicitRoleParam,
      roleFromQuery,
      selectedTask: routeSelectedTask,
      sessionlessRole: roleFromQuery,
    }).sessionSummary;
  }, [
    hasExplicitRoleParam,
    isRepoNavigationBoundaryPending,
    roleFromQuery,
    selectedSessionFromRoute,
    sessionKeyParam,
    sessionsByTaskId,
    taskIdParam,
    tasksById,
  ]);

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
        if (isAgentSessionActivityActive(session.activityState)) {
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
    activeWorkspaceId,
    isRepoNavigationBoundaryPending,
    taskId,
    selectedTask,
    tasks,
    isLoadingTasks,
    latestSessionByTaskId,
    activeSessionByTaskId,
    selectAgentStudioSelection,
  });

  const selectedViewTaskId = activeTaskTabId || taskId;

  const selectedViewTask = useMemo(
    () => (selectedViewTaskId ? (tasksById.get(selectedViewTaskId) ?? null) : null),
    [tasksById, selectedViewTaskId],
  );

  const selectedViewSessions = useMemo(() => {
    if (!selectedViewTaskId) {
      return [];
    }
    return sessionsByTaskId.get(selectedViewTaskId) ?? [];
  }, [sessionsByTaskId, selectedViewTaskId]);

  const isDetachedFromSelectedTask = Boolean(
    selectedViewTaskId && taskId && selectedViewTaskId !== taskId,
  );
  const viewSessionKey = isDetachedFromSelectedTask
    ? null
    : agentStudioSelectionSessionKey(selectionState);
  const viewSessionIdentity = isDetachedFromSelectedTask ? null : selectionState.sessionIdentity;
  const viewRole = isDetachedFromSelectedTask ? "spec" : selectionState.role;
  const hasExplicitRoleSelection =
    !isDetachedFromSelectedTask && selectionState.hasExplicitRoleSelection;
  const keepExplicitRoleSessionless =
    !isDetachedFromSelectedTask && selectionState.keepSessionless && viewSessionKey === null;

  const selectedSessionView = useAgentStudioSelectedSessionView({
    workspaceRepoPath,
    selectedTask: selectedViewTask,
    sessionSummaries: selectedViewSessions,
    sessionKey: viewSessionKey,
    hasExplicitRoleSelection,
    roleSelection: viewRole,
    sessionlessRole: viewRole,
    keepExplicitRoleSessionless,
    sessionIdentityFromRoute: viewSessionIdentity,
    repoSettings,
    isLoadingRepoSettings,
  });
  useSelectedSessionHistoryLoad({
    session: selectedSessionView.selectedSession.loadedSession,
    repoReadinessState: selectedSessionView.selectedSession.runtimeReadiness.state,
  });
  const isActiveTaskReady = Boolean(activeWorkspaceId && selectedViewTaskId);

  return useMemo<AgentStudioSelectionControllerResult>(
    () => ({
      selectedSessionFromRoute,
      taskId,
      selectedTask,
      allSessionSummaries: sessions,
      sessionsForTask,
      resolvedRouteSession,
      isLoadingTasks,
      activeTaskTabId,
      availableTabTasks,
      taskTabs,
      handleSelectTab,
      handleCreateTab,
      handleCloseTab,
      handleReorderTab,
      view: {
        taskId: selectedViewTaskId,
        selectedTask: selectedViewTask,
        sessionsForTask: selectedViewSessions,
        isTaskReady: isActiveTaskReady,
        ...selectedSessionView,
      },
    }),
    [
      activeTaskTabId,
      availableTabTasks,
      handleCloseTab,
      handleCreateTab,
      handleReorderTab,
      handleSelectTab,
      isActiveTaskReady,
      isLoadingTasks,
      resolvedRouteSession,
      selectedSessionView,
      selectedSessionFromRoute,
      selectedTask,
      sessions,
      sessionsForTask,
      taskId,
      taskTabs,
      selectedViewTask,
      selectedViewSessions,
      selectedViewTaskId,
    ],
  );
}
