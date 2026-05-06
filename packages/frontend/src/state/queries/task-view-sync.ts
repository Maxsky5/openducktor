import type { SettingsSnapshot } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { refreshCachedTaskDocumentQueries, removeCachedTaskDocumentQueries } from "./documents";
import {
  invalidateRepoTaskQueries,
  loadRepoTaskDataFromQuery,
  refreshCachedKanbanQueries,
  taskQueryKeys,
} from "./tasks";
import { settingsSnapshotQueryOptions, workspaceQueryKeys } from "./workspace";

type BaseRepoTaskViewRefreshOptions = {
  forceFreshTaskList?: boolean;
};

const isCancelledQueryError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  ("revert" in error || error.constructor.name === "CancelledError");

export type RepoTaskViewRefreshOptions = BaseRepoTaskViewRefreshOptions &
  (
    | {
        taskDocumentStrategy?: "none";
      }
    | {
        taskDocumentStrategy: "refresh";
        taskIds: string[];
      }
    | {
        taskDocumentStrategy: "remove";
        taskIds: string[];
      }
  );

export const refreshRepoTaskViewsFromQuery = async (
  queryClient: QueryClient,
  repoPath: string,
  options?: RepoTaskViewRefreshOptions,
): Promise<void> => {
  const settingsQueryKey = workspaceQueryKeys.settingsSnapshot();
  const cachedSettings = queryClient.getQueryData<SettingsSnapshot>(settingsQueryKey);
  const settingsQueryState = queryClient.getQueryState(settingsQueryKey);
  const settings =
    settingsQueryState?.status === "success" &&
    settingsQueryState.fetchStatus === "idle" &&
    !settingsQueryState.isInvalidated &&
    cachedSettings
      ? cachedSettings
      : await queryClient.fetchQuery({
          ...settingsSnapshotQueryOptions(),
          staleTime: 0,
        });
  const doneVisibleDays = settings.kanban.doneVisibleDays;

  const taskDocumentRefresh =
    options?.taskDocumentStrategy === "refresh"
      ? refreshCachedTaskDocumentQueries(queryClient, repoPath, options.taskIds)
      : Promise.resolve();

  if (options?.taskDocumentStrategy === "remove") {
    removeCachedTaskDocumentQueries(queryClient, repoPath, options.taskIds);
  }

  if (
    options?.forceFreshTaskList === true ||
    options?.taskDocumentStrategy === "refresh" ||
    options?.taskDocumentStrategy === "remove"
  ) {
    try {
      await queryClient.cancelQueries(
        {
          queryKey: taskQueryKeys.repoDataPrefix(repoPath),
          exact: false,
        },
        { silent: true },
      );
    } catch (error) {
      if (!isCancelledQueryError(error)) {
        throw error;
      }
    }
  }
  await invalidateRepoTaskQueries(queryClient, repoPath);
  await Promise.all([
    loadRepoTaskDataFromQuery(queryClient, repoPath, doneVisibleDays),
    refreshCachedKanbanQueries(queryClient, repoPath, { excludeDoneVisibleDays: doneVisibleDays }),
    taskDocumentRefresh,
  ]);
};
