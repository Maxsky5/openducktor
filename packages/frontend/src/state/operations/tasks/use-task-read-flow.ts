import type { TaskCard } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { type MutableRefObject, useCallback, useEffect, useMemo, useRef } from "react";
import type { TaskRefreshOptions } from "@/state/app-state-contexts";
import { getProductionTaskViewSync } from "@/state/queries/task-view-sync";
import { getTaskReadLoadingState } from "./task-read-loading-state";
import { useTaskQueryReadModel } from "./use-task-query-read-model";
import { useTaskRefreshFlow } from "./use-task-refresh-flow";

type UseTaskReadFlowArgs = {
  activeRepoPath: string | null;
};

type TaskToastDedupeRef = MutableRefObject<{ repoPath: string; description: string } | null>;

export type UseTaskReadFlowResult = {
  tasks: TaskCard[];
  isForegroundLoadingTasks: boolean;
  isRefreshingTasksInBackground: boolean;
  isLoadingTasks: boolean;
  setIsLoadingTasks: (value: boolean) => void;
  clearTaskReadState: () => void;
  refreshTaskData: (repoPath: string, taskIdOrIds?: string | string[]) => Promise<void>;
  loadWorkspaceTasks: (repoPath: string) => Promise<void>;
  refreshTasksWithOptions: (options?: TaskRefreshOptions) => Promise<void>;
  refreshTasks: () => Promise<void>;
};

export function useTaskReadFlow({ activeRepoPath }: UseTaskReadFlowArgs): UseTaskReadFlowResult {
  const queryClient = useQueryClient();
  const taskViewSync = useMemo(() => getProductionTaskViewSync(queryClient), [queryClient]);
  const lastTaskRefreshToastRef = useRef<{ repoPath: string; description: string } | null>(null);
  const lastTaskLoadErrorToastRef = useRef<{ repoPath: string; description: string } | null>(null);

  const refreshTaskData = useCallback(
    async (repoPath: string, taskIdOrIds?: string | string[]) => {
      const taskIds = toTaskIds(taskIdOrIds);
      if (taskIds) {
        await taskViewSync.refreshAfterLocalMutation(repoPath, {
          kind: "refresh-documents",
          taskIds,
        });
        return;
      }

      await taskViewSync.refreshManually(repoPath);
    },
    [taskViewSync],
  );

  const refreshFlow = useTaskRefreshFlow({
    activeRepoPath,
    refreshTaskData,
    lastTaskRefreshToastRef,
    lastTaskLoadErrorToastRef,
  });

  useTaskReadFlowRepoSwitchCleanup({
    activeRepoPath,
    resetManualLoading: refreshFlow.resetManualLoading,
    lastTaskRefreshToastRef,
    lastTaskLoadErrorToastRef,
  });

  const readModel = useTaskQueryReadModel({ activeRepoPath, lastTaskLoadErrorToastRef });

  const clearTaskReadState = useCallback(() => {
    refreshFlow.resetManualLoading();
    lastTaskRefreshToastRef.current = null;
  }, [refreshFlow.resetManualLoading]);

  const loadingState = getTaskReadLoadingState({
    activeRepoPath,
    isManualLoadingTasks: refreshFlow.isManualLoadingTasks,
    isSettingsLoadingForActiveRepo: readModel.isSettingsLoadingForActiveRepo,
    isTaskQueryLoadingForActiveRepo: readModel.isTaskQueryLoadingForActiveRepo,
    isTaskQueryFetchingForActiveRepo: readModel.isTaskQueryFetchingForActiveRepo,
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
  if (typeof taskIdOrIds === "string") {
    return [taskIdOrIds];
  }
  if (Array.isArray(taskIdOrIds)) {
    return taskIdOrIds;
  }
  return null;
};

const useTaskReadFlowRepoSwitchCleanup = ({
  activeRepoPath,
  resetManualLoading,
  lastTaskRefreshToastRef,
  lastTaskLoadErrorToastRef,
}: {
  activeRepoPath: string | null;
  resetManualLoading: () => void;
  lastTaskRefreshToastRef: TaskToastDedupeRef;
  lastTaskLoadErrorToastRef: TaskToastDedupeRef;
}): void => {
  const currentWorkspaceRepoPathRef = useRef(activeRepoPath);

  useEffect(() => {
    const previousActiveRepoPath = currentWorkspaceRepoPathRef.current;
    currentWorkspaceRepoPathRef.current = activeRepoPath;
    if (previousActiveRepoPath !== activeRepoPath) {
      resetManualLoading();
      lastTaskRefreshToastRef.current = null;
      lastTaskLoadErrorToastRef.current = null;
    }
  }, [activeRepoPath, lastTaskLoadErrorToastRef, lastTaskRefreshToastRef, resetManualLoading]);
};
