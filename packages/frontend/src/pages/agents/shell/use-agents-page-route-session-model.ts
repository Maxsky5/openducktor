import { startTransition, useCallback, useEffect } from "react";
import { useLocation, useNavigationType, useSearchParams } from "react-router";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { RepoSettingsInput } from "@/types/state-slices";
import type { AgentStudioQueryUpdate } from "../query-sync/agent-studio-navigation";
import { useAgentStudioQuerySync } from "../query-sync/use-agent-studio-query-sync";
import { useAgentStudioSelectionController } from "../use-agent-studio-selection-controller";
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

  const {
    taskIdParam,
    sessionExternalIdParam,
    hasExplicitRoleParam,
    roleFromQuery,
    isRepoNavigationBoundaryPending,
    navigationPersistenceError,
    retryNavigationPersistence,
    updateQuery,
  } = useAgentStudioQuerySync({
    activeWorkspaceId,
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

  useEffect(() => {
    if (!selection.queryUpdate) {
      return;
    }

    scheduleQueryUpdate(selection.queryUpdate);
  }, [scheduleQueryUpdate, selection.queryUpdate]);

  return {
    navigationPersistenceError,
    retryNavigationPersistence,
    scheduleQueryUpdate,
    selection,
    selectAgentStudioSelection,
    taskExecutionFilePreview,
  };
}
