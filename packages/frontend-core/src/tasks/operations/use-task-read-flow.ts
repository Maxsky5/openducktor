import type { WorkspaceRef } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { type MutableRefObject, useCallback, useEffect, useMemo, useRef } from "react";
import type { TaskRefreshOptions } from "../../app-state/app-state-contexts";
import { getProductionTaskViewSync } from "../../queries/task-view-sync";
import { getTaskReadLoadingState } from "./task-read-loading-state";
import { useTaskQueryReadModel } from "./use-task-query-read-model";
import { useTaskRefreshFlow } from "./use-task-refresh-flow";
import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";

type UseTaskReadFlowArgs = {
  activeWorkspaceId: string | null;
  activeRepoPath: string | null;
};

type TaskToastDedupeRef = MutableRefObject<{
  workspaceId: string;
  repoPath: string;
  description: string;
} | null>;

export type UseTaskReadFlowResult = {
  tasks: TaskCard[];
  tasksAreCurrent: boolean;
  isForegroundLoadingTasks: boolean;
  isRefreshingTasksInBackground: boolean;
  isLoadingTasks: boolean;
  setIsLoadingTasks: (value: boolean) => void;
  clearTaskReadState: () => void;
  refreshTaskData: (scope: WorkspaceRef, taskIdOrIds?: string | string[]) => Promise<void>;
  loadWorkspaceTasks: (scope: WorkspaceRef) => Promise<void>;
  refreshTasksWithOptions: (options?: TaskRefreshOptions) => Promise<void>;
  refreshTasks: () => Promise<void>;
};

export function useTaskReadFlow({
  activeWorkspaceId,
  activeRepoPath,
}: UseTaskReadFlowArgs): UseTaskReadFlowResult {
  const queryClient = useQueryClient();
  const taskViewSync = useMemo(() => getProductionTaskViewSync(queryClient), [queryClient]);
  const lastTaskRefreshToastRef = useRef<{
    workspaceId: string;
    repoPath: string;
    description: string;
  } | null>(null);
  const lastTaskLoadErrorToastRef = useRef<{
    workspaceId: string;
    repoPath: string;
    description: string;
  } | null>(null);

  const refreshTaskData = useCallback(
    async (scope: WorkspaceRef, taskIdOrIds?: string | string[]) => {
      const taskIds = toTaskIds(taskIdOrIds);
      if (taskIds) {
        await taskViewSync.refreshDocumentsForTasks(scope, taskIds);
        return;
      }

      await taskViewSync.refreshManually(scope);
    },
    [taskViewSync],
  );

  const refreshFlow = useTaskRefreshFlow({
    activeWorkspaceId,
    activeRepoPath,
    refreshTaskData,
    lastTaskRefreshToastRef,
    lastTaskLoadErrorToastRef,
  });
  const { resetManualLoading } = refreshFlow;

  useTaskReadFlowRepoSwitchCleanup({
    activeWorkspaceId,
    activeRepoPath,
    resetManualLoading,
    lastTaskRefreshToastRef,
    lastTaskLoadErrorToastRef,
  });

  const readModel = useTaskQueryReadModel({
    activeWorkspaceId,
    activeRepoPath,
    lastTaskLoadErrorToastRef,
  });

  const clearTaskReadState = useCallback(() => {
    resetManualLoading();
    lastTaskRefreshToastRef.current = null;
  }, [resetManualLoading]);

  const loadingState = getTaskReadLoadingState({
    activeRepoPath,
    isManualLoadingTasks: refreshFlow.isManualLoadingTasks,
    isSettingsLoadingForActiveRepo: readModel.isSettingsLoadingForActiveRepo,
    isTaskQueryLoadingForActiveRepo: readModel.isTaskQueryLoadingForActiveRepo,
    isTaskQueryFetchingForActiveRepo: readModel.isTaskQueryFetchingForActiveRepo,
    isTaskQuerySuccessForActiveRepo: readModel.isTaskQuerySuccessForActiveRepo,
  });

  return {
    tasks: readModel.tasks,
    ...loadingState,
    setIsLoadingTasks: refreshFlow.setIsLoadingTasks,
    clearTaskReadState,
    refreshTaskData,
    loadWorkspaceTasks: taskViewSync.loadWorkspace,
    refreshTasksWithOptions: refreshFlow.refreshTasksWithOptions,
    refreshTasks: refreshFlow.refreshTasks,
  };
}

const toTaskIds = (taskIdOrIds?: string | string[]): string[] | null => {
  if (Array.isArray(taskIdOrIds)) {
    return taskIdOrIds;
  }
  return taskIdOrIds === undefined ? null : [taskIdOrIds];
};

const useTaskReadFlowRepoSwitchCleanup = ({
  activeWorkspaceId,
  activeRepoPath,
  resetManualLoading,
  lastTaskRefreshToastRef,
  lastTaskLoadErrorToastRef,
}: {
  activeWorkspaceId: string | null;
  activeRepoPath: string | null;
  resetManualLoading: () => void;
  lastTaskRefreshToastRef: TaskToastDedupeRef;
  lastTaskLoadErrorToastRef: TaskToastDedupeRef;
}): void => {
  const currentWorkspaceRef = useRef({ activeWorkspaceId, activeRepoPath });

  useEffect(() => {
    const previousWorkspace = currentWorkspaceRef.current;
    currentWorkspaceRef.current = { activeWorkspaceId, activeRepoPath };
    if (
      previousWorkspace.activeWorkspaceId !== activeWorkspaceId ||
      previousWorkspace.activeRepoPath !== activeRepoPath
    ) {
      resetManualLoading();
      lastTaskRefreshToastRef.current = null;
      lastTaskLoadErrorToastRef.current = null;
    }
  }, [
    activeWorkspaceId,
    activeRepoPath,
    lastTaskLoadErrorToastRef,
    lastTaskRefreshToastRef,
    resetManualLoading,
  ]);
};
