import type { BeadsCheck, TaskCard } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import type { TaskDataRefreshOptions, TaskRefreshOptions } from "@/state/app-state-contexts";
import { refreshRepoTaskViewsFromQuery } from "@/state/queries/task-view-sync";
import { useTaskQueryReadModel } from "./use-task-query-read-model";
import { useTaskRefreshFlow } from "./use-task-refresh-flow";

type UseTaskReadFlowArgs = {
  activeRepoPath: string | null;
  refreshBeadsCheckForRepo: (repoPath: string, force?: boolean) => Promise<BeadsCheck>;
};

export type UseTaskReadFlowResult = {
  tasks: TaskCard[];
  isForegroundLoadingTasks: boolean;
  isRefreshingTasksInBackground: boolean;
  isLoadingTasks: boolean;
  setIsLoadingTasks: (value: boolean) => void;
  clearTaskReadState: () => void;
  refreshTaskData: (
    repoPath: string,
    taskIdOrIds?: string | string[],
    options?: TaskDataRefreshOptions,
  ) => Promise<void>;
  refreshTasksWithOptions: (options?: TaskRefreshOptions) => Promise<void>;
  refreshTasks: () => Promise<void>;
};

export function useTaskReadFlow({
  activeRepoPath,
  refreshBeadsCheckForRepo,
}: UseTaskReadFlowArgs): UseTaskReadFlowResult {
  const queryClient = useQueryClient();
  const lastTaskRefreshToastRef = useRef<{ repoPath: string; description: string } | null>(null);
  const lastTaskLoadErrorToastRef = useRef<{ repoPath: string; description: string } | null>(null);
  const currentWorkspaceRepoPathRef = useRef(activeRepoPath);
  const manualLoadingRepoPathRef = useRef(activeRepoPath);

  useEffect(() => {
    const previousActiveRepoPath = currentWorkspaceRepoPathRef.current;
    currentWorkspaceRepoPathRef.current = activeRepoPath;
    if (previousActiveRepoPath !== activeRepoPath) {
      lastTaskRefreshToastRef.current = null;
      lastTaskLoadErrorToastRef.current = null;
    }
  }, [activeRepoPath]);

  const readModel = useTaskQueryReadModel({ activeRepoPath, lastTaskLoadErrorToastRef });

  const refreshTaskData = useCallback(
    async (repoPath: string, taskIdOrIds?: string | string[], options?: TaskDataRefreshOptions) => {
      const taskIds = toTaskIds(taskIdOrIds);
      if (options?.source === "external-sync") {
        await refreshRepoTaskViewsFromQuery(queryClient, repoPath, {
          forceFreshTaskList: true,
          ancillaryFailureMode: "best-effort",
          ignorePrimaryCancellation: true,
          refreshInactiveViews: false,
          ...(taskIds
            ? { taskDocumentStrategy: "invalidate", taskIds }
            : { taskDocumentStrategy: "none" }),
        });
        return;
      }

      await refreshRepoTaskViewsFromQuery(
        queryClient,
        repoPath,
        taskIds
          ? { taskDocumentStrategy: "refresh", taskIds }
          : {
              forceFreshTaskList: options?.forceFreshTaskList ?? true,
              taskDocumentStrategy: "none",
            },
      );
    },
    [queryClient],
  );

  const refreshFlow = useTaskRefreshFlow({
    activeRepoPath,
    refreshBeadsCheckForRepo,
    refreshTaskData,
    lastTaskRefreshToastRef,
  });

  useEffect(() => {
    const previousActiveRepoPath = manualLoadingRepoPathRef.current;
    manualLoadingRepoPathRef.current = activeRepoPath;
    if (previousActiveRepoPath !== activeRepoPath) {
      refreshFlow.resetManualLoading();
    }
  }, [activeRepoPath, refreshFlow.resetManualLoading]);

  const clearTaskReadState = useCallback(() => {
    refreshFlow.resetManualLoading();
    lastTaskRefreshToastRef.current = null;
  }, [refreshFlow.resetManualLoading]);

  const isForegroundLoadingTasks =
    refreshFlow.isManualLoadingTasks ||
    readModel.isSettingsLoadingForActiveRepo ||
    readModel.isTaskQueryLoadingForActiveRepo;
  const isRefreshingTasksInBackground =
    readModel.isTaskQueryFetchingForActiveRepo && !isForegroundLoadingTasks;

  return {
    tasks: readModel.tasks,
    isForegroundLoadingTasks,
    isRefreshingTasksInBackground,
    isLoadingTasks: isForegroundLoadingTasks,
    setIsLoadingTasks: refreshFlow.setIsLoadingTasks,
    clearTaskReadState,
    refreshTaskData,
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
