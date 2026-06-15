import type { RuntimeDescriptor, TaskCard } from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentRole,
  AgentSessionRef,
  AgentSessionTodoItem,
} from "@openducktor/core";
import { useMemo } from "react";
import { isAgentSessionWorkingStatus } from "@/lib/agent-session-status";
import type { useChecksState } from "@/state";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { useRuntimeDefinitionsContext } from "@/state/app-state-contexts";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  findAgentStudioSessionSelectionCandidate,
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
  activeWorkspace: ActiveWorkspace | null;
  isRepoNavigationBoundaryPending: boolean;
  tasks: TaskCard[];
  isLoadingTasks: boolean;
  sessions: AgentSessionSummary[];
  isLoadingSessionReadModel: boolean;
  sessionReadModelError: string | null;
  taskIdParam: string;
  sessionKeyParam: string | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
  selectionIntent: AgentStudioSelectionIntent | null;
  updateQuery: (updates: QueryUpdate) => void;
  loadAgentSessionHistory: (session: AgentSessionIdentity) => Promise<void>;
  runtimeDefinitions: RuntimeDescriptor[];
  isLoadingRuntimeDefinitions: ReturnType<
    typeof useRuntimeDefinitionsContext
  >["isLoadingRuntimeDefinitions"];
  runtimeDefinitionsError: ReturnType<
    typeof useRuntimeDefinitionsContext
  >["runtimeDefinitionsError"];
  runtimeHealthByRuntime: ReturnType<typeof useChecksState>["runtimeHealthByRuntime"];
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
  readSessionModelCatalog: (
    repoPath: string,
    runtimeKind: NonNullable<AgentSessionState["runtimeKind"]>,
  ) => Promise<AgentModelCatalog>;
  readSessionTodos: (session: AgentSessionRef) => Promise<AgentSessionTodoItem[]>;
};

export type AgentStudioSelectionControllerResult = {
  selectedSessionFromRoute: AgentSessionSummary | null;
  taskId: string;
  selectedTask: TaskCard | null;
  allSessionSummaries: AgentSessionSummary[];
  sessionsForTask: AgentSessionSummary[];
  activeSessionSummary: AgentSessionSummary | null;
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
  viewSessionRuntimeData: AgentStudioSelectedSessionView["runtimeData"];
  viewSessionRuntimeDataError?: AgentStudioSelectedSessionView["runtimeDataError"];
  viewRuntimeReadiness: AgentStudioSelectedSessionView["runtimeReadiness"];
  viewRole: AgentRole;
  viewLaunchActionId: AgentStudioSelectedSessionView["launchActionId"];
  isActiveTaskReady: boolean;
  viewSessionLifecycle: AgentStudioSelectedSessionView["lifecycle"];
};

export function useAgentStudioSelectionController({
  activeWorkspace,
  isRepoNavigationBoundaryPending,
  tasks,
  isLoadingTasks,
  sessions,
  isLoadingSessionReadModel,
  sessionReadModelError,
  taskIdParam,
  sessionKeyParam,
  hasExplicitRoleParam,
  roleFromQuery,
  selectionIntent,
  updateQuery,
  loadAgentSessionHistory,
  runtimeDefinitions,
  isLoadingRuntimeDefinitions,
  runtimeDefinitionsError,
  runtimeHealthByRuntime,
  isLoadingChecks,
  refreshChecks,
  readSessionModelCatalog,
  readSessionTodos,
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
    () => findAgentStudioSessionSelectionCandidate(sessions, routeSelectionParams.sessionKeyParam),
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

  const activeSessionSummary = useMemo(() => {
    return resolveAgentStudioSessionSelection({
      sessionsForTask,
      sessionKey: routeSelectionParams.sessionKeyParam,
      hasExplicitRoleParam: routeSelectionParams.hasExplicitRoleParam,
      roleFromQuery: routeSelectionParams.roleFromQuery,
      selectedTask,
      fallbackRole: routeSelectionParams.roleFromQuery,
      keepExplicitRoleSessionless: routeSelectionParams.keepExplicitRoleSessionless,
    }).activeSession;
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
        if (isAgentSessionWorkingStatus(session.status)) {
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

  const viewSelectionParams = resolveAgentStudioViewSelectionParams({
    baseParams: selectionBaseParams,
    routeTaskId: taskId,
    viewTaskId,
  });

  const selectedSessionView = useAgentStudioSelectedSessionView({
    activeWorkspace,
    selectedTask: viewSelectedTask,
    sessionSummaries: viewSessionsForTask,
    sessionKey: viewSelectionParams.sessionKeyParam,
    hasExplicitRoleSelection: viewSelectionParams.hasExplicitRoleSelection,
    roleSelection: viewSelectionParams.roleSelection,
    fallbackRole: viewSelectionParams.fallbackRole,
    keepExplicitRoleSessionless: viewSelectionParams.keepExplicitRoleSessionless,
    selectionIntent: viewSelectionParams.selectionIntent,
    sessionIdentityFromRoute: viewSelectionParams.sessionIdentity,
    sessionReadModelError,
    isLoadingSessionReadModel,
    runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
    runtimeHealthByRuntime,
    isLoadingChecks,
    refreshChecks,
    loadAgentSessionHistory,
    readSessionModelCatalog,
    readSessionTodos,
  });
  const isActiveTaskReady = Boolean(activeWorkspace && viewTaskId);

  return useMemo<AgentStudioSelectionControllerResult>(
    () => ({
      selectedSessionFromRoute,
      taskId,
      selectedTask,
      allSessionSummaries: sessions,
      sessionsForTask,
      activeSessionSummary,
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
      viewActiveSessionSummary: selectedSessionView.sessionSummary,
      viewActiveSession: selectedSessionView.session,
      viewSessionRuntimeData: selectedSessionView.runtimeData,
      viewSessionRuntimeDataError: selectedSessionView.runtimeDataError,
      viewRuntimeReadiness: selectedSessionView.runtimeReadiness,
      viewRole: selectedSessionView.role,
      viewLaunchActionId: selectedSessionView.launchActionId,
      isActiveTaskReady,
      viewSessionLifecycle: selectedSessionView.lifecycle,
    }),
    [
      activeSessionSummary,
      activeTaskTabId,
      availableTabTasks,
      handleCloseTab,
      handleCreateTab,
      handleReorderTab,
      handleSelectTab,
      isActiveTaskReady,
      isLoadingTasks,
      selectedSessionView.launchActionId,
      selectedSessionView.lifecycle,
      selectedSessionView.role,
      selectedSessionView.runtimeData,
      selectedSessionView.runtimeDataError,
      selectedSessionView.runtimeReadiness,
      selectedSessionView.session,
      selectedSessionView.sessionSummary,
      selectedSessionFromRoute,
      selectedTask,
      sessions,
      sessionsForTask,
      taskId,
      taskTabs,
      viewSelectedTask,
      viewSessionsForTask,
      viewTaskId,
    ],
  );
}
