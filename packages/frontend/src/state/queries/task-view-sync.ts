import type { QueryClient } from "@tanstack/react-query";
import { refreshCachedTaskDocumentQueries, removeCachedTaskDocumentQueries } from "./documents";
import {
  invalidateRepoTaskQueries,
  loadRepoTaskDataFromQuery,
  refreshCachedKanbanQueries,
  taskQueryKeys,
} from "./tasks";

type TaskListRefreshState = {
  forceFreshRequested: boolean;
  promise: Promise<void>;
  trailingRefreshRequested: boolean;
};

const taskListRefreshesByClient = new WeakMap<QueryClient, Map<string, TaskListRefreshState>>();

const taskListRefreshesForClient = (
  queryClient: QueryClient,
): Map<string, TaskListRefreshState> => {
  const existing = taskListRefreshesByClient.get(queryClient);
  if (existing) {
    return existing;
  }

  const refreshes = new Map<string, TaskListRefreshState>();
  taskListRefreshesByClient.set(queryClient, refreshes);
  return refreshes;
};

const cancelRepoTaskListQueries = (
  queryClient: QueryClient,
  repoPath: string,
): Promise<unknown[]> =>
  Promise.all([
    queryClient.cancelQueries({
      queryKey: taskQueryKeys.repoData(repoPath),
      exact: true,
    }),
    queryClient.cancelQueries({
      queryKey: taskQueryKeys.visibleTasks(repoPath),
      exact: true,
    }),
    queryClient.cancelQueries({
      queryKey: taskQueryKeys.kanbanDataPrefix(repoPath),
      exact: false,
    }),
  ]);

const refreshRepoTaskListViewsFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  options?: { forceFresh?: boolean },
): Promise<void> => {
  const refreshes = taskListRefreshesForClient(queryClient);
  const forceFresh = options?.forceFresh ?? false;
  const currentRefresh = refreshes.get(repoPath);
  if (currentRefresh) {
    currentRefresh.forceFreshRequested = currentRefresh.forceFreshRequested || forceFresh;
    currentRefresh.trailingRefreshRequested = true;
    if (forceFresh) {
      void cancelRepoTaskListQueries(queryClient, repoPath);
    }
    return currentRefresh.promise;
  }

  const refreshState: TaskListRefreshState = {
    forceFreshRequested: forceFresh,
    promise: Promise.resolve(),
    trailingRefreshRequested: false,
  };

  const promise = (async () => {
    // Joined refreshes request one trailing pass instead of collapsing completely:
    // a post-write refresh must not publish a pre-write in-flight task list.
    do {
      const shouldForceFresh = refreshState.forceFreshRequested;
      refreshState.forceFreshRequested = false;
      refreshState.trailingRefreshRequested = false;
      if (shouldForceFresh) {
        await cancelRepoTaskListQueries(queryClient, repoPath);
      }

      try {
        await invalidateRepoTaskQueries(queryClient, repoPath);
        await Promise.all([
          loadRepoTaskDataFromQuery(queryClient, repoPath),
          refreshCachedKanbanQueries(queryClient, repoPath, { force: false }),
        ]);
      } catch (error) {
        if (refreshState.trailingRefreshRequested || refreshState.forceFreshRequested) {
          continue;
        }

        throw error;
      }

      await Promise.resolve();
    } while (refreshState.trailingRefreshRequested);
    if (refreshes.get(repoPath) === refreshState) {
      refreshes.delete(repoPath);
    }
  })().finally(() => {
    if (refreshes.get(repoPath) === refreshState) {
      refreshes.delete(repoPath);
    }
  });

  refreshState.promise = promise;
  refreshes.set(repoPath, refreshState);
  return promise;
};

type BaseRepoTaskViewRefreshOptions = {
  forceFreshTaskList?: boolean;
};

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
  const taskDocumentRefresh =
    options?.taskDocumentStrategy === "refresh"
      ? refreshCachedTaskDocumentQueries(queryClient, repoPath, options.taskIds)
      : Promise.resolve();

  if (options?.taskDocumentStrategy === "remove") {
    removeCachedTaskDocumentQueries(queryClient, repoPath, options.taskIds);
  }

  await Promise.all([
    refreshRepoTaskListViewsFromQuery(queryClient, repoPath, {
      forceFresh:
        options?.forceFreshTaskList === true ||
        options?.taskDocumentStrategy === "refresh" ||
        options?.taskDocumentStrategy === "remove",
    }),
    taskDocumentRefresh,
  ]);
};
