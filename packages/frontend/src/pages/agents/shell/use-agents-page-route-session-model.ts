import { useQuery } from "@tanstack/react-query";
import { startTransition, useCallback, useEffect, useMemo } from "react";
import { useLocation, useNavigationType, useSearchParams } from "react-router";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { useAgentSessionReadModelState } from "@/state/app-state-provider";
import { repoConfigQueryOptions } from "@/state/queries/workspace";
import type { RepoSettingsInput } from "@/types/state-slices";
import type { AgentStudioQueryUpdate } from "../query-sync/agent-studio-navigation";
import {
  createAgentStudioStateSnapshot,
  reconcileAgentStudioStateForReadModel,
} from "../agent-studio-workspace-state";
import { useAgentStudioQuerySync } from "../query-sync/use-agent-studio-query-sync";
import { useAgentStudioSelectionController } from "../use-agent-studio-selection-controller";
import { useAgentStudioWorkspaceStatePersistence } from "../use-agent-studio-workspace-state-persistence";
import {
  type UseTaskExecutionFilePreviewControllerResult,
  useTaskExecutionFilePreviewController,
} from "../use-task-execution-file-preview-controller";
import type { SelectAgentStudioSelection } from "./agent-studio-selection-state";
import { useAgentStudioSelectionState } from "./use-agent-studio-selection-state";

type UseAgentsPageRouteSessionModelArgs = {
  activeWorkspaceId: string | null;
  workspaceRepoPath: string | null;
  tasks: Parameters<typeof useAgentStudioSelectionController>[0]["tasks"];
  isForegroundLoadingTasks: boolean;
  sessions: AgentSessionSummary[];
  repoSettings: RepoSettingsInput | null;
  isLoadingRepoSettings: boolean;
};

const INACTIVE_AGENT_STUDIO_WORKSPACE_ID = "__inactive_agent_studio_workspace__";

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
  isForegroundLoadingTasks,
  sessions,
  repoSettings,
  isLoadingRepoSettings,
}: UseAgentsPageRouteSessionModelArgs): AgentsPageRouteSessionModel {
  const { key: locationKey } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigationType = useNavigationType();
  const { sessionReadModelLoadState } = useAgentSessionReadModelState();
  const repoConfigQuery = useQuery({
    ...repoConfigQueryOptions(activeWorkspaceId ?? INACTIVE_AGENT_STUDIO_WORKSPACE_ID),
    enabled: activeWorkspaceId !== null,
  });
  const loadedAgentStudioState = repoConfigQuery.data?.agentStudioState ?? null;
  const isWaitingForSavedSession = Boolean(
    loadedAgentStudioState?.activeTask?.externalSessionId &&
    sessionReadModelLoadState.kind === "loading",
  );
  const agentStudioState = useMemo(() => {
    if (!loadedAgentStudioState || isForegroundLoadingTasks || isWaitingForSavedSession) {
      return null;
    }
    return reconcileAgentStudioStateForReadModel({
      state: loadedAgentStudioState,
      tasks,
      sessions,
    });
  }, [isForegroundLoadingTasks, isWaitingForSavedSession, loadedAgentStudioState, sessions, tasks]);
  const agentStudioStateLoadError =
    repoConfigQuery.error instanceof Error ? repoConfigQuery.error : null;
  const refetchAgentStudioState = repoConfigQuery.refetch;
  const retryAgentStudioStateLoad = useCallback((): void => {
    void refetchAgentStudioState();
  }, [refetchAgentStudioState]);

  const {
    taskIdParam,
    sessionExternalIdParam,
    hasExplicitRoleParam,
    roleFromQuery,
    isRepoNavigationBoundaryPending,
    isWorkspaceStateLoaded,
    navigationPersistenceError,
    updateQuery,
  } = useAgentStudioQuerySync({
    activeWorkspaceId,
    agentStudioState,
    isLoadingAgentStudioState:
      repoConfigQuery.isLoading || isForegroundLoadingTasks || isWaitingForSavedSession,
    agentStudioStateError: agentStudioStateLoadError,
    retryAgentStudioStateLoad,
    locationKey,
    navigationType,
    searchParams,
    setSearchParams,
  });

  const scheduleQueryUpdate = useCallback(
    (updates: AgentStudioQueryUpdate): void => {
      // Local selection state owns click responsiveness; URL persistence must not block it.
      startTransition(() => {
        updateQuery(updates);
      });
    },
    [updateQuery],
  );

  const taskExecutionFilePreview = useTaskExecutionFilePreviewController();
  const { selection: selectionState, selectAgentStudioSelection: applyAgentStudioSelection } =
    useAgentStudioSelectionState({
      isRepoNavigationBoundaryPending,
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
    agentStudioState,
    workspaceRepoPath,
    isRepoNavigationBoundaryPending,
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
    selectAgentStudioSelection,
  });

  const stateSnapshot = useMemo(
    () =>
      createAgentStudioStateSnapshot({
        openTaskIds: selection.tabTaskIds,
        taskId: selection.view.taskId,
        role: selection.view.role,
        externalSessionId: selection.view.selectedSession.identity?.externalSessionId ?? null,
      }),
    [
      selection.tabTaskIds,
      selection.view.role,
      selection.view.selectedSession.identity?.externalSessionId,
      selection.view.taskId,
    ],
  );
  const { persistenceError: stateSaveError, retryPersistence: retryAgentStudioStateSave } =
    useAgentStudioWorkspaceStatePersistence({
      workspaceId: activeWorkspaceId,
      loadedState: loadedAgentStudioState,
      state: stateSnapshot,
      enabled:
        isWorkspaceStateLoaded &&
        !isRepoNavigationBoundaryPending &&
        !isForegroundLoadingTasks &&
        selection.loadedStateWorkspaceId === activeWorkspaceId,
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
    if (!selection.queryUpdate) {
      return;
    }

    scheduleQueryUpdate(selection.queryUpdate);
  }, [scheduleQueryUpdate, selection.queryUpdate]);

  return {
    navigationPersistenceError: navigationPersistenceError ?? stateSaveError,
    retryNavigationPersistence,
    scheduleQueryUpdate,
    selection,
    selectAgentStudioSelection,
    taskExecutionFilePreview,
  };
}
