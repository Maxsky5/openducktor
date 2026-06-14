import type { AgentSessionRecord, RuntimeDescriptor, TaskCard } from "@openducktor/contracts";
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
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { AgentStudioQueryUpdate as QueryUpdate } from "./agent-studio-navigation";
import {
  findAgentStudioSessionSelectionCandidate,
  groupSessionsByTaskId,
  resolveAgentStudioSessionSelection,
  resolveAgentStudioTaskId,
} from "./agents-page-selection";
import {
  type AgentStudioSelectedSessionView,
  useAgentStudioSelectedSessionView,
} from "./selected-session/use-agent-studio-selected-session-view";
import { useAgentStudioTaskTabs } from "./use-agent-studio-task-tabs";

type UseAgentStudioSelectionControllerArgs = {
  activeWorkspace: ActiveWorkspace | null;
  isRepoNavigationBoundaryPending: boolean;
  tasks: TaskCard[];
  isLoadingTasks: boolean;
  taskSessionRecordsByTaskId: Record<string, AgentSessionRecord[]>;
  isLoadingTaskSessionRecords: boolean;
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
  loadAgentSessionHistory: (input: { session: AgentSessionState }) => Promise<void>;
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
  readSessionTodos: (session: AgentSessionRef) => Promise<AgentSessionTodoItem[]>;
  clearComposerInput: () => void;
  onContextSwitchIntent?: () => void;
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
  viewRole: AgentRole;
  viewLaunchActionId: AgentStudioSelectedSessionView["launchActionId"];
  isActiveTaskReady: boolean;
  isViewSessionResolving: boolean;
  viewSessionLifecycle: AgentStudioSelectedSessionView["lifecycle"];
};

const EMPTY_PERSISTED_SESSION_RECORDS: AgentSessionRecord[] = [];

export function useAgentStudioSelectionController({
  activeWorkspace,
  isRepoNavigationBoundaryPending,
  tasks,
  isLoadingTasks,
  taskSessionRecordsByTaskId,
  isLoadingTaskSessionRecords,
  sessions,
  sessionReadModelError,
  taskIdParam,
  sessionParam,
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

  const sessionsByTaskId = useMemo(() => groupSessionsByTaskId(sessions), [sessions]);

  const selectedSessionFromRoute = useMemo(
    () => findAgentStudioSessionSelectionCandidate(sessions, selectedSessionParam),
    [selectedSessionParam, sessions],
  );

  const taskId = resolveAgentStudioTaskId({
    taskIdParam: selectedTaskIdParam,
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
      externalSessionId: selectedSessionParam,
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
  const viewPersistedSessionRecords = viewTaskId
    ? (taskSessionRecordsByTaskId[viewTaskId] ?? EMPTY_PERSISTED_SESSION_RECORDS)
    : EMPTY_PERSISTED_SESSION_RECORDS;

  const isViewTaskDetachedFromQuery = Boolean(viewTaskId && taskId && viewTaskId !== taskId);
  const hasViewRoleSelection = effectiveHasExplicitRoleParam && !isViewTaskDetachedFromQuery;
  const viewSelectionIntent =
    effectiveSelectionIntent && effectiveSelectionIntent.taskId === viewTaskId
      ? effectiveSelectionIntent
      : null;
  const viewHasExplicitRoleSelection = viewSelectionIntent !== null ? true : hasViewRoleSelection;
  const viewRoleFromSelection = viewSelectionIntent?.role ?? effectiveRoleFromQuery;
  const viewSessionParamFromSelection =
    viewSelectionIntent?.externalSessionId ?? effectiveSessionParam;

  const selectedSessionView = useAgentStudioSelectedSessionView({
    activeWorkspace,
    selectedTask: viewSelectedTask,
    sessionSummaries: viewSessionsForTask,
    persistedRecords: viewPersistedSessionRecords,
    externalSessionId: viewSessionParamFromSelection,
    hasExplicitRoleSelection: viewHasExplicitRoleSelection,
    roleSelection: viewRoleFromSelection,
    fallbackRole: isViewTaskDetachedFromQuery ? "spec" : viewRoleFromSelection,
    keepExplicitRoleSessionless:
      viewSelectionIntent?.externalSessionId === null && effectiveSessionParam === null,
    sessionReadModelError,
    isLoadingTaskSessionRecords,
    runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
    runtimeHealthByRuntime,
    isLoadingChecks,
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
      viewRole: selectedSessionView.role,
      viewLaunchActionId: selectedSessionView.launchActionId,
      isActiveTaskReady,
      isViewSessionResolving: selectedSessionView.isResolving,
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
      selectedSessionView.isResolving,
      selectedSessionView.launchActionId,
      selectedSessionView.lifecycle,
      selectedSessionView.role,
      selectedSessionView.runtimeData,
      selectedSessionView.runtimeDataError,
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
