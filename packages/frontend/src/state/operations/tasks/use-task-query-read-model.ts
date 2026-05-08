import type { TaskCard } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { summarizeTaskLoadError } from "@/state/tasks/task-load-errors";
import { repoTaskDataQueryOptions } from "../../queries/tasks";
import { settingsSnapshotQueryOptions } from "../../queries/workspace";

type UseTaskQueryReadModelArgs = {
  activeRepoPath: string | null;
  lastTaskLoadErrorToastRef: React.MutableRefObject<{
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
};

export function useTaskQueryReadModel({
  activeRepoPath,
  lastTaskLoadErrorToastRef,
}: UseTaskQueryReadModelArgs): TaskQueryReadModel {
  const settingsSnapshotQuery = useQuery(settingsSnapshotQueryOptions());
  const settingsSnapshot = settingsSnapshotQuery.data ?? null;
  const doneVisibleDays = settingsSnapshot?.kanban.doneVisibleDays ?? null;
  const repoTaskDataQuery = useQuery({
    ...repoTaskDataQueryOptions(activeRepoPath ?? "__disabled__", doneVisibleDays ?? -1),
    enabled: activeRepoPath !== null && doneVisibleDays !== null,
  });

  useEffect(() => {
    let taskLoadError: unknown = null;
    if (settingsSnapshotQuery.isError) {
      taskLoadError = settingsSnapshotQuery.error;
    } else if (repoTaskDataQuery.isError) {
      taskLoadError = repoTaskDataQuery.error;
    }

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
    toast.error("Failed to load tasks", { description });
  }, [
    activeRepoPath,
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
  };
}
