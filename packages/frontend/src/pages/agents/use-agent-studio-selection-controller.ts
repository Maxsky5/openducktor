import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useMemo } from "react";
import { isAgentSessionActivityActive } from "@/lib/agent-session-activity-state";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import {
  resolveSelectedSessionHistoryLoadTarget,
  useSelectedSessionHistoryLoad,
} from "@/state/operations/agent-orchestrator/history/use-selected-session-history-load";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  findAgentStudioSessionSummaryByKey,
  groupSessionsByTaskId,
  resolveAgentStudioSessionSelection,
  resolveAgentStudioTaskId,
} from "./agents-page-selection";
import type { AgentStudioQueryUpdate as QueryUpdate } from "./query-sync/agent-studio-navigation";
import {
  type AgentStudioSelectedSessionView,
  useAgentStudioSelectedSessionView,
} from "./selected-session/use-agent-studio-selected-session-view";
import type { AgentStudioSelectionIntent } from "./shell/agent-studio-selection-intent";
import {
  resolveAgentStudioRouteSelectionParams,
  resolveAgentStudioSelectionBaseParams,
  resolveAgentStudioViewSelectionParams,
} from "./shell/agent-studio-selection-route";
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
  selectionIntent: AgentStudioSelectionIntent | null;
  repoSettings: RepoSettingsInput | null;
  isLoadingRepoSettings: boolean;
  updateQuery: (updates: QueryUpdate) => void;
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
  selectionIntent,
  repoSettings,
  isLoadingRepoSettings,
  updateQuery,
}: UseAgentStudioSelectionControllerArgs): AgentStudioSelectionControllerResult {
  const selectionBaseParams = resolveAgentStudioSelectionBaseParams({
    isRepoNavigationBoundaryPending,
    taskIdParam,
    sessionKeyParam,
    hasExplicitRoleParam,
    roleFromQuery,
    selectionIntent,
  });
  const routeSelectionParams = resolveAgentStudioRouteSelectionParams(selectionBaseParams);

  const tasksById = useMemo(() => {
    return new Map(tasks.map((task) => [task.id, task]));
  }, [tasks]);

  const sessionsByTaskId = useMemo(() => groupSessionsByTaskId(sessions), [sessions]);

  const selectedSessionFromRoute = useMemo(
    () => findAgentStudioSessionSummaryByKey(sessions, routeSelectionParams.sessionKeyParam),
    [routeSelectionParams.sessionKeyParam, sessions],
  );

  const taskId = resolveAgentStudioTaskId({
    taskIdParam: routeSelectionParams.taskIdParam,
    selectedSessionFromRoute,
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
    return resolveAgentStudioSessionSelection({
      sessionsForTask,
      sessionKey: routeSelectionParams.sessionKeyParam,
      hasExplicitRoleParam: routeSelectionParams.hasExplicitRoleParam,
      roleFromQuery: routeSelectionParams.roleFromQuery,
      selectedTask,
      sessionlessRole: routeSelectionParams.roleFromQuery,
      keepExplicitRoleSessionless: routeSelectionParams.keepExplicitRoleSessionless,
    }).sessionSummary;
  }, [
    routeSelectionParams.hasExplicitRoleParam,
    routeSelectionParams.keepExplicitRoleSessionless,
    routeSelectionParams.roleFromQuery,
    routeSelectionParams.sessionKeyParam,
    selectedTask,
    sessionsForTask,
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
    updateQuery,
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

  const viewSelectionParams = resolveAgentStudioViewSelectionParams({
    baseParams: selectionBaseParams,
    routeTaskId: taskId,
    viewTaskId: selectedViewTaskId,
  });

  const selectedSessionView = useAgentStudioSelectedSessionView({
    workspaceRepoPath,
    selectedTask: selectedViewTask,
    sessionSummaries: selectedViewSessions,
    sessionKey: viewSelectionParams.sessionKeyParam,
    hasExplicitRoleSelection: viewSelectionParams.hasExplicitRoleSelection,
    roleSelection: viewSelectionParams.roleSelection,
    sessionlessRole: viewSelectionParams.sessionlessRole,
    keepExplicitRoleSessionless: viewSelectionParams.keepExplicitRoleSessionless,
    selectionIntent: viewSelectionParams.selectionIntent,
    sessionIdentityFromRoute: viewSelectionParams.sessionIdentity,
    repoSettings,
    isLoadingRepoSettings,
  });
  useSelectedSessionHistoryLoad({
    target: resolveSelectedSessionHistoryLoadTarget({
      session: selectedSessionView.loadedSession,
      repoReadinessState: selectedSessionView.runtimeReadiness.readinessState,
    }),
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
