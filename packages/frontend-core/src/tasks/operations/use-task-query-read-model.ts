import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type MutableRefObject, useEffect } from "react";
import { useClientConnection } from "../../connection/client-connection-react";
import { summarizeTaskLoadError } from "../task-load-errors";
import { repoTaskDataQueryOptions, taskQueryKeys } from "../../queries/tasks";
import { settingsSnapshotQueryOptions } from "../../queries/workspace";
import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";

type UseTaskQueryReadModelArgs = {
  activeRepoPath: string | null;
  lastTaskLoadErrorToastRef: MutableRefObject<{
    repoPath: string;
    description: string;
  } | null>;
};

export type TaskQueryReadModel = {
  tasks: TaskCard[];
  doneVisibleDays: number | null;
  isSettingsLoadingForActiveRepo: boolean;
  isTaskQueryLoadingForActiveRepo: boolean;
  isTaskQueryFetchingForActiveRepo: boolean;
  isTaskQuerySuccessForActiveRepo: boolean;
};

export function useTaskQueryReadModel({
  activeRepoPath,
  lastTaskLoadErrorToastRef,
}: UseTaskQueryReadModelArgs): TaskQueryReadModel {
  const queryClient = useQueryClient();
  const { feedback } = useClientConnection();
  const settingsSnapshotQuery = useQuery(settingsSnapshotQueryOptions());
  const settingsSnapshot = settingsSnapshotQuery.data ?? null;
  const doneVisibleDays = settingsSnapshot?.kanban.doneVisibleDays ?? null;
  const taskRepoPath = activeRepoPath ?? "__disabled__";
  const hasLoadedTaskData =
    queryClient.getQueryState(taskQueryKeys.repoData(taskRepoPath))?.status === "success";
  const repoTaskDataQuery = useQuery({
    ...repoTaskDataQueryOptions(taskRepoPath),
    enabled: activeRepoPath !== null && doneVisibleDays !== null && hasLoadedTaskData,
  });

  useEffect(() => {
    const taskLoadError = settingsSnapshotQuery.isError
      ? settingsSnapshotQuery.error
      : repoTaskDataQuery.isError
        ? repoTaskDataQuery.error
        : null;

    if (!taskLoadError || !activeRepoPath) {
      if (!taskLoadError) {
        lastTaskLoadErrorToastRef.current = null;
      }
      return;
    }

    const description = summarizeTaskLoadError({ error: taskLoadError });
    const lastToast = lastTaskLoadErrorToastRef.current;
    if (lastToast?.repoPath === activeRepoPath && lastToast.description === description) {
      return;
    }

    lastTaskLoadErrorToastRef.current = { repoPath: activeRepoPath, description };
    feedback.show("error", "Failed to load tasks", { description });
  }, [
    activeRepoPath,
    feedback,
    lastTaskLoadErrorToastRef,
    repoTaskDataQuery.error,
    repoTaskDataQuery.isError,
    settingsSnapshotQuery.error,
    settingsSnapshotQuery.isError,
  ]);

  return {
    tasks: activeRepoPath && doneVisibleDays !== null ? (repoTaskDataQuery.data?.tasks ?? []) : [],
    doneVisibleDays,
    isSettingsLoadingForActiveRepo: activeRepoPath !== null && settingsSnapshotQuery.isPending,
    isTaskQueryLoadingForActiveRepo:
      activeRepoPath !== null && doneVisibleDays !== null && repoTaskDataQuery.isPending,
    isTaskQueryFetchingForActiveRepo: activeRepoPath !== null && repoTaskDataQuery.isFetching,
    isTaskQuerySuccessForActiveRepo:
      activeRepoPath !== null && doneVisibleDays !== null && repoTaskDataQuery.isSuccess,
  };
}
