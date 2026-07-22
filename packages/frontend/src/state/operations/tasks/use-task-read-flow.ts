import type { TaskCard } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { type MutableRefObject, useCallback, useEffect, useRef } from "react";
import type { TaskDataRefreshOptions, TaskRefreshOptions } from "@/state/app-state-contexts";
import {
  refreshRepoTaskViewsAfterMutation,
  refreshRepoTaskViewsFromQuery,
} from "@/state/queries/task-view-sync";
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
  refreshTaskData: (
    repoPath: string,
    taskIdOrIds?: string | string[],
    options?: TaskDataRefreshOptions,
  ) => Promise<void>;
  refreshTasksWithOptions: (options?: TaskRefreshOptions) => Promise<void>;
  refreshTasks: () => Promise<void>;
};

export function useTaskReadFlow({ activeRepoPath }: UseTaskReadFlowArgs): UseTaskReadFlowResult {
  const queryClient = useQueryClient();
  const lastTaskRefreshToastRef = useRef<{ repoPath: string; description: string } | null>(null);
  const lastTaskLoadErrorToastRef = useRef<{ repoPath: string; description: string } | null>(null);

  const refreshTaskData = useCallback(
    async (repoPath: string, taskIdOrIds?: string | string[], options?: TaskDataRefreshOptions) => {
      const taskIds = toTaskIds(taskIdOrIds);
      if (options?.source === "external-sync") {
        await refreshRepoTaskViewsAfterMutation(queryClient, repoPath, {
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

      if (taskIds) {
        await refreshRepoTaskViewsAfterMutation(queryClient, repoPath, {
          forceFreshTaskList: true,
          ignorePrimaryCancellation: true,
          taskDocumentStrategy: "refresh",
          taskIds,
        });
        return;
      }

      await refreshRepoTaskViewsFromQuery(queryClient, repoPath, {
        forceFreshTaskList: options?.forceFreshTaskList ?? true,
        taskDocumentStrategy: "none",
      });
    },
    [queryClient],
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
