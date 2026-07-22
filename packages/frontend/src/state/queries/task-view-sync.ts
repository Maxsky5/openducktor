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

type RepoTaskViewRefreshMode = "passive" | "after_mutation";

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
  ignoreCancellation = false,
): Promise<void> => {
  if (mode === "reject") {
    if (!ignoreCancellation) {
      await Promise.all(promises);
      return;
    }

    const results = await Promise.allSettled(promises);
    const failure = results.find(
      (result) => result.status === "rejected" && !isCancelledQueryError(result.reason),
    );
    if (failure?.status === "rejected") {
      throw failure.reason;
    }
    return;
  }

  const results = await Promise.allSettled(promises);
  for (const settled of results) {
    if (
      settled.status === "rejected" &&
      !(ignoreCancellation && isCancelledQueryError(settled.reason))
    ) {
      console.warn("Background task cache refresh failed", { error: settled.reason });
    }
  }
};

const runMutationAncillaryRefresh = async (
  queryClient: QueryClient,
  repoPath: string,
  doneVisibleDays: number,
  taskDocumentRefresh: () => Promise<void>,
  ancillaryFailureMode: "reject" | "best-effort",
  ignorePrimaryCancellation: boolean,
  refreshInactiveViews: boolean,
): Promise<void> => {
  const ancillaryRefreshes: Promise<unknown>[] = [taskDocumentRefresh()];
  if (refreshInactiveViews) {
    ancillaryRefreshes.push(
      refreshCachedKanbanQueries(queryClient, repoPath, {
        excludeDoneVisibleDays: doneVisibleDays,
      }),
    );
  }
  await runAncillaryRefresh(ancillaryRefreshes, ancillaryFailureMode, ignorePrimaryCancellation);
};

export const refreshRepoTaskViewsFromQuery = async (
  queryClient: QueryClient,
  repoPath: string,
  options?: RepoTaskViewRefreshOptions,
): Promise<void> => refreshRepoTaskViews(queryClient, repoPath, "passive", options);

export const refreshRepoTaskViewsAfterMutation = async (
  queryClient: QueryClient,
  repoPath: string,
  options?: RepoTaskViewRefreshOptions,
): Promise<void> => refreshRepoTaskViews(queryClient, repoPath, "after_mutation", options);

const refreshRepoTaskViews = async (
  queryClient: QueryClient,
  repoPath: string,
  mode: RepoTaskViewRefreshMode,
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

  if (mode === "after_mutation") {
    await queryClient.cancelQueries(
      {
        queryKey: taskQueryKeys.repoDataPrefix(repoPath),
        exact: false,
      },
      { silent: true },
    );
  }

  await invalidateRepoTaskQueries(queryClient, repoPath);
  try {
    await loadRepoTaskDataFromQuery(queryClient, repoPath, doneVisibleDays);
  } catch (error) {
    if (ignorePrimaryCancellation && isCancelledQueryError(error)) {
      await runMutationAncillaryRefresh(
        queryClient,
        repoPath,
        doneVisibleDays,
        taskDocumentRefresh,
        ancillaryFailureMode,
        ignorePrimaryCancellation,
        refreshInactiveViews,
      );
      return;
    }
    throw error;
  }

  await runMutationAncillaryRefresh(
    queryClient,
    repoPath,
    doneVisibleDays,
    taskDocumentRefresh,
    ancillaryFailureMode,
    ignorePrimaryCancellation,
    refreshInactiveViews,
  );
};
