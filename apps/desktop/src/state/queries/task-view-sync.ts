import type { QueryClient } from "@tanstack/react-query";
import { refreshCachedTaskDocumentQueries, removeCachedTaskDocumentQueries } from "./documents";
import {
  invalidateRepoTaskQueries,
  loadRepoTaskDataFromQuery,
  refreshCachedKanbanQueries,
} from "./tasks";

export type RepoTaskViewRefreshOptions =
  | {
      taskDocumentStrategy?: "none";
    }
  | {
      taskDocumentStrategy: "refresh";
      taskId: string;
    }
  | {
      taskDocumentStrategy: "remove";
      taskIds: string[];
    };

export const refreshRepoTaskViewsFromQuery = async (
  queryClient: QueryClient,
  repoPath: string,
  options?: RepoTaskViewRefreshOptions,
): Promise<void> => {
  const taskDocumentRefresh =
    options?.taskDocumentStrategy === "refresh"
      ? refreshCachedTaskDocumentQueries(queryClient, repoPath, options.taskId)
      : Promise.resolve();

  if (options?.taskDocumentStrategy === "remove") {
    removeCachedTaskDocumentQueries(queryClient, repoPath, options.taskIds);
  }

  await invalidateRepoTaskQueries(queryClient, repoPath);
  await Promise.all([
    loadRepoTaskDataFromQuery(queryClient, repoPath),
    refreshCachedKanbanQueries(queryClient, repoPath),
    taskDocumentRefresh,
  ]);
};
