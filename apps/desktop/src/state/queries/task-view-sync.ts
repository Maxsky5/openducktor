import type { QueryClient } from "@tanstack/react-query";
import { refreshCachedTaskDocumentQueries } from "./documents";
import {
  invalidateRepoTaskQueries,
  loadRepoTaskDataFromQuery,
  refreshCachedKanbanQueries,
} from "./tasks";

export const refreshRepoTaskViewsFromQuery = async (
  queryClient: QueryClient,
  repoPath: string,
  options?: {
    taskId?: string;
  },
): Promise<void> => {
  await invalidateRepoTaskQueries(queryClient, repoPath);
  await Promise.all([
    loadRepoTaskDataFromQuery(queryClient, repoPath),
    refreshCachedKanbanQueries(queryClient, repoPath),
    ...(options?.taskId
      ? [refreshCachedTaskDocumentQueries(queryClient, repoPath, options.taskId)]
      : []),
  ]);
};
