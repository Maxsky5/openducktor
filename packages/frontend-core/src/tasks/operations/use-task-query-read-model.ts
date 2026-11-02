import type { WorkspaceRef } from "@openducktor/contracts";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { type MutableRefObject, useEffect } from "react";
import { useClientConnection } from "../../connection/client-connection-react";
import { summarizeTaskLoadError } from "../task-load-errors";
import { repoTaskDataQueryOptions, taskQueryKeys, type RepoTaskData } from "../../queries/tasks";
import { settingsSnapshotQueryOptions } from "../../queries/workspace";
import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";

type UseTaskQueryReadModelArgs = {
  activeWorkspaceId: string | null;
  activeRepoPath: string | null;
  lastTaskLoadErrorToastRef: MutableRefObject<{
    workspaceId: string;
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
  activeWorkspaceId,
  activeRepoPath,
  lastTaskLoadErrorToastRef,
}: UseTaskQueryReadModelArgs): TaskQueryReadModel {
  const queryClient = useQueryClient();
  const { feedback } = useClientConnection();
  const settingsSnapshotQuery = useQuery(settingsSnapshotQueryOptions());
  const settingsSnapshot = settingsSnapshotQuery.data ?? null;
  const doneVisibleDays = settingsSnapshot?.kanban.doneVisibleDays ?? null;
  const scope: WorkspaceRef = {
    workspaceId: activeWorkspaceId ?? "__disabled__",
    repoPath: activeRepoPath ?? "__disabled__",
  };
  const hasActiveWorkspace = activeWorkspaceId !== null && activeRepoPath !== null;
  const hasLoadedTaskData =
    queryClient.getQueryState(taskQueryKeys.repoData(scope))?.status === "success";
  const repoTaskDataQuery = useQuery({
    ...repoTaskDataQueryOptions(scope),
    enabled: hasActiveWorkspace && doneVisibleDays !== null && hasLoadedTaskData,
  });

  useEffect(() => {
    const taskLoadError = settingsSnapshotQuery.isError
      ? settingsSnapshotQuery.error
      : repoTaskDataQuery.isError
        ? repoTaskDataQuery.error
        : null;

    if (!taskLoadError || !activeRepoPath || !activeWorkspaceId) {
      if (!taskLoadError) {
        lastTaskLoadErrorToastRef.current = null;
      }
      return;
    }

    const description = summarizeTaskLoadError({ error: taskLoadError });
    const lastToast = lastTaskLoadErrorToastRef.current;
    if (
      lastToast?.workspaceId === activeWorkspaceId &&
      lastToast.repoPath === activeRepoPath &&
      lastToast.description === description
    ) {
      return;
    }

    lastTaskLoadErrorToastRef.current = {
      workspaceId: activeWorkspaceId,
      repoPath: activeRepoPath,
      description,
    };
    feedback.show("error", "Failed to load tasks", { description });
  }, [
    activeWorkspaceId,
    activeRepoPath,
    feedback,
    lastTaskLoadErrorToastRef,
    repoTaskDataQuery.error,
    repoTaskDataQuery.isError,
    settingsSnapshotQuery.error,
    settingsSnapshotQuery.isError,
  ]);

  return taskQueryReadModel({
    hasActiveWorkspace,
    doneVisibleDays,
    isSettingsPending: settingsSnapshotQuery.isPending,
    taskQuery: repoTaskDataQuery,
  });
}

function taskQueryReadModel({
  hasActiveWorkspace,
  doneVisibleDays,
  isSettingsPending,
  taskQuery,
}: {
  hasActiveWorkspace: boolean;
  doneVisibleDays: number | null;
  isSettingsPending: boolean;
  taskQuery: Pick<UseQueryResult<RepoTaskData>, "data" | "isPending" | "isFetching" | "isSuccess">;
}): TaskQueryReadModel {
  const hasTaskSettings = hasActiveWorkspace && doneVisibleDays !== null;
  return {
    tasks: hasTaskSettings ? (taskQuery.data?.tasks ?? []) : [],
    doneVisibleDays,
    isSettingsLoadingForActiveRepo: hasActiveWorkspace && isSettingsPending,
    isTaskQueryLoadingForActiveRepo: hasTaskSettings && taskQuery.isPending,
    isTaskQueryFetchingForActiveRepo: hasActiveWorkspace && taskQuery.isFetching,
    isTaskQuerySuccessForActiveRepo: hasTaskSettings && taskQuery.isSuccess,
  };
}
