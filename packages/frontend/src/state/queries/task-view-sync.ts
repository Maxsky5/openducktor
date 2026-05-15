import type { SettingsSnapshot } from "@openducktor/contracts";
import { isCancelledError, type QueryClient } from "@tanstack/react-query";
import {
  invalidateCachedTaskDocumentQueries,
  refreshCachedTaskDocumentQueries,
  removeCachedTaskDocumentQueries,
} from "./documents";
import {
  invalidateRepoTaskQueries,
  loadRepoTaskDataFromQuery,
  refreshCachedKanbanQueries,
  repoTaskDataQueryOptions,
  taskQueryKeys,
} from "./tasks";
import { settingsSnapshotQueryOptions, workspaceQueryKeys } from "./workspace";

type BaseRepoTaskViewRefreshOptions = {
  forceFreshTaskList?: boolean;
  ancillaryFailureMode?: "reject" | "best-effort";
  ignorePrimaryCancellation?: boolean;
  refreshInactiveViews?: boolean;
};

const isCancelledQueryError = (error: unknown): boolean => isCancelledError(error);

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
        taskDocumentStrategy: "invalidate";
        taskIds: string[];
      }
    | {
        taskDocumentStrategy: "remove";
        taskIds: string[];
      }
  );

const runAncillaryRefresh = async (
  promises: Promise<unknown>[],
  mode: "reject" | "best-effort",
): Promise<void> => {
  if (mode === "reject") {
    await Promise.all(promises);
    return;
  }

  const results = await Promise.allSettled(promises);
  for (const settled of results) {
    if (settled.status === "rejected") {
      console.warn("Background task cache refresh failed", { error: settled.reason });
    }
  }
};

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
  const ancillaryFailureMode = options?.ancillaryFailureMode ?? "reject";
  const ignorePrimaryCancellation = options?.ignorePrimaryCancellation ?? false;
  const refreshInactiveViews = options?.refreshInactiveViews ?? true;

  if (
    options?.forceFreshTaskList !== true &&
    (options?.taskDocumentStrategy === undefined || options.taskDocumentStrategy === "none")
  ) {
    const taskDataQueryState = queryClient.getQueryState(
      taskQueryKeys.repoData(repoPath, doneVisibleDays),
    );

    if (taskDataQueryState?.status === "success") {
      return;
    }

    await queryClient.fetchQuery(repoTaskDataQueryOptions(repoPath, doneVisibleDays));
    return;
  }

  const taskDocumentRefresh = async (): Promise<void> => {
    if (options?.taskDocumentStrategy === "refresh") {
      await refreshCachedTaskDocumentQueries(queryClient, repoPath, options.taskIds);
      return;
    }

    if (options?.taskDocumentStrategy === "invalidate") {
      await invalidateCachedTaskDocumentQueries(queryClient, repoPath, options.taskIds);
    }
  };

  if (options?.taskDocumentStrategy === "remove") {
    removeCachedTaskDocumentQueries(queryClient, repoPath, options.taskIds);
  }

  await invalidateRepoTaskQueries(queryClient, repoPath);
  try {
    await loadRepoTaskDataFromQuery(queryClient, repoPath, doneVisibleDays);
  } catch (error) {
    if (ignorePrimaryCancellation && isCancelledQueryError(error)) {
      if (options?.taskDocumentStrategy === "invalidate") {
        await runAncillaryRefresh([taskDocumentRefresh()], ancillaryFailureMode);
      }
      return;
    }
    throw error;
  }

  const ancillaryRefreshes: Promise<unknown>[] = [taskDocumentRefresh()];
  if (refreshInactiveViews) {
    ancillaryRefreshes.push(
      refreshCachedKanbanQueries(queryClient, repoPath, {
        excludeDoneVisibleDays: doneVisibleDays,
      }),
    );
  }

  await runAncillaryRefresh(ancillaryRefreshes, ancillaryFailureMode);
};
