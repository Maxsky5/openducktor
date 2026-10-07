import {
  notificationRouteSessionIdentity,
  notificationRouteStateSchema,
} from "@/features/notifications/notification-route-state";
import { startTransition, useCallback, useEffect, useMemo } from "react";
import { useLocation, useNavigationType, useSearchParams } from "react-router";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { useAgentSessionReadModelState } from "@/state/app-state-provider";
import type { RepoSettingsInput } from "@/types/state-slices";
import type { AgentStudioQueryUpdate } from "../query-sync/agent-studio-navigation";
import { createAgentStudioStateSnapshot } from "../agent-studio-workspace-state";
import { useAgentStudioQuerySync } from "../query-sync/use-agent-studio-query-sync";
import { useAgentStudioSelectionController } from "../use-agent-studio-selection-controller";
import { useAgentStudioWorkspaceStateSave } from "../use-agent-studio-workspace-state-save";
import { useAgentStudioWorkspaceStateLoad } from "../use-agent-studio-workspace-state-load";
import {
  type UseTaskExecutionFilePreviewControllerResult,
  useTaskExecutionFilePreviewController,
} from "@/components/features/agents/file-preview/use-task-execution-file-preview-controller";
import type { SessionNavigationTarget } from "@/features/session-navigation/session-navigation-target";
import { usePublishVisibleSessionTarget } from "@/features/session-navigation/visible-session-target";
import { useStableAgentSessionIdentity } from "@/lib/use-stable-agent-session-identity";
import type { SelectAgentStudioSelection } from "./agent-studio-selection-state";
import { useAgentStudioSelectionState } from "./use-agent-studio-selection-state";
import { useTaskPreviewTransitionGuard } from "./use-task-preview-transition-guard";

type UseAgentsPageRouteSessionModelArgs = {
  activeWorkspaceId: string | null;
  workspaceRepoPath: string | null;
  tasks: Parameters<typeof useAgentStudioSelectionController>[0]["tasks"];
  tasksAreCurrent: boolean;
  isForegroundLoadingTasks: boolean;
  sessions: AgentSessionSummary[];
  repoSettings: RepoSettingsInput | null;
  isLoadingRepoSettings: boolean;
};

export type AgentsPageRouteSessionModel = {
  navigationPersistenceError: Error | null;
  retryNavigationPersistence: () => void;
  scheduleQueryUpdate: (updates: AgentStudioQueryUpdate) => void;
  selection: ReturnType<typeof useAgentStudioSelectionController>;
  selectAgentStudioSelection: SelectAgentStudioSelection;
  taskExecutionFilePreview: UseTaskExecutionFilePreviewControllerResult;
};

export function useAgentsPageRouteSessionModel({
  activeWorkspaceId,
  workspaceRepoPath,
  tasks,
  tasksAreCurrent,
  isForegroundLoadingTasks,
  sessions,
  repoSettings,
  isLoadingRepoSettings,
}: UseAgentsPageRouteSessionModelArgs): AgentsPageRouteSessionModel {
  const { key: locationKey, state: locationState } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigationType = useNavigationType();
  const { sessionReadModelLoadState } = useAgentSessionReadModelState();
  const {
    loadedAgentStudioState,
    agentStudioState,
    isLoading: isLoadingAgentStudioState,
    error: agentStudioStateLoadError,
    retry: retryAgentStudioStateLoad,
    canSave: canSaveAgentStudioState,
  } = useAgentStudioWorkspaceStateLoad({
    activeWorkspaceId,
    tasks,
    isLoadingTasks: isForegroundLoadingTasks,
    tasksAreCurrent,
    sessions,
    sessionReadModelLoadState,
  });

  const {
    taskIdParam,
    sessionExternalIdParam,
    sessionIdentityParam,
    hasExplicitRoleParam,
    roleFromQuery,
    isWorkspaceRestorePending,
    isWorkspaceStateLoaded,
    navigationPersistenceError,
    updateQuery,
  } = useAgentStudioQuerySync({
    activeWorkspaceId,
    agentStudioState,
    isLoadingAgentStudioState,
    agentStudioStateError: agentStudioStateLoadError,
    retryAgentStudioStateLoad,
    locationKey,
    navigationType,
    searchParams,
    setSearchParams,
  });

  const scheduleQueryUpdate = useCallback(
    (updates: AgentStudioQueryUpdate): void => {
      // Keep the URL write out of the click's main render.
      startTransition(() => {
        updateQuery(updates);
      });
    },
    [updateQuery],
  );

  const addressSessionIdentity = useStableAgentSessionIdentity(sessionIdentityParam);
  const routeSessionIdentity = useMemo(() => {
    const state = notificationRouteStateSchema.safeParse(locationState);
    const notificationIdentity = notificationRouteSessionIdentity(
      state.success ? state.data.notificationTarget : null,
      workspaceRepoPath,
      taskIdParam,
      sessionExternalIdParam,
    );
    return notificationIdentity ?? addressSessionIdentity;
  }, [
    addressSessionIdentity,
    locationState,
    workspaceRepoPath,
    taskIdParam,
    sessionExternalIdParam,
  ]);

  const taskExecutionFilePreview = useTaskExecutionFilePreviewController();
  const {
    selection: selectionState,
    isRoutePending,
    selectAgentStudioSelection: applyAgentStudioSelection,
  } = useAgentStudioSelectionState({
    activeWorkspaceId,
    routeSessionIdentity,
    isWorkspaceRestorePending,
    taskIdParam,
    sessionExternalIdParam,
    hasExplicitRoleParam,
    roleFromQuery,
    scheduleQueryUpdate,
    requestContextTransition: taskExecutionFilePreview.requestContextTransition,
  });
  const selectAgentStudioSelection: SelectAgentStudioSelection = applyAgentStudioSelection;
  const selection = useAgentStudioSelectionController({
    activeWorkspaceId,
    workspaceRepoPath,
    isWorkspaceRestorePending,
    tasks,
    isLoadingTasks: isForegroundLoadingTasks,
    sessions,
    taskIdParam,
    sessionExternalIdParam,
    hasExplicitRoleParam,
    roleFromQuery,
    selectionState,
    repoSettings,
    isLoadingRepoSettings,
  });

  const stateSnapshot = useMemo(
    () =>
      createAgentStudioStateSnapshot({
        openTaskIds: loadedAgentStudioState?.openTaskIds ?? [],
        taskId: selection.view.taskId,
        role: selection.view.role,
        externalSessionId: selection.view.selectedSession.identity?.externalSessionId ?? null,
      }),
    [
      loadedAgentStudioState?.openTaskIds,
      selection.view.role,
      selection.view.selectedSession.identity?.externalSessionId,
      selection.view.taskId,
    ],
  );
  const { saveError: stateSaveError, retrySave: retryAgentStudioStateSave } =
    useAgentStudioWorkspaceStateSave({
      workspaceId: activeWorkspaceId,
      loadedState: loadedAgentStudioState,
      state: stateSnapshot,
      enabled:
        canSaveAgentStudioState &&
        isWorkspaceStateLoaded &&
        !isWorkspaceRestorePending &&
        !isRoutePending &&
        selection.view.selectedTask !== null,
    });
  const retryNavigationPersistence = useCallback((): void => {
    if (navigationPersistenceError) {
      retryAgentStudioStateLoad();
    }
    if (stateSaveError) {
      retryAgentStudioStateSave();
    }
  }, [
    navigationPersistenceError,
    retryAgentStudioStateLoad,
    retryAgentStudioStateSave,
    stateSaveError,
  ]);

  useEffect(() => {
    if (isRoutePending || !selection.queryUpdate) {
      return;
    }

    scheduleQueryUpdate(selection.queryUpdate);
  }, [isRoutePending, scheduleQueryUpdate, selection.queryUpdate]);

  useTaskPreviewTransitionGuard(taskExecutionFilePreview, workspaceRepoPath);

  const visibleIdentity = useStableAgentSessionIdentity(selection.view.selectedSession.identity);
  const visibleTaskId = selection.view.taskId;
  const visibleRole = selection.view.role;
  const visibleTarget = useMemo<SessionNavigationTarget | null>(() => {
    if (!activeWorkspaceId || !visibleTaskId) return null;
    return visibleIdentity
      ? {
          kind: "task_session",
          workspaceId: activeWorkspaceId,
          taskId: visibleTaskId,
          role: visibleRole,
          identity: visibleIdentity,
        }
      : { kind: "task", workspaceId: activeWorkspaceId, taskId: visibleTaskId, role: visibleRole };
  }, [activeWorkspaceId, visibleIdentity, visibleRole, visibleTaskId]);
  usePublishVisibleSessionTarget(visibleTarget);

  return {
    navigationPersistenceError: navigationPersistenceError ?? stateSaveError,
    retryNavigationPersistence,
    scheduleQueryUpdate,
    selection,
    selectAgentStudioSelection,
    taskExecutionFilePreview,
  };
}
