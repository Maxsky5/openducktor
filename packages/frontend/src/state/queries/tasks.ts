import type { TaskCard } from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { hostClient as host } from "@/lib/host-client";

const TASK_DATA_STALE_TIME_MS = 30_000;

export type RepoTaskData = {
  tasks: TaskCard[];
};

export type ListTasks = (repoPath: string) => Promise<TaskCard[]>;

export const taskQueryKeys = {
  all: ["tasks"] as const,
  repoDataPrefix: (repoPath: string) => [...taskQueryKeys.all, "repo-data", repoPath] as const,
  repoData: (repoPath: string) => taskQueryKeys.repoDataPrefix(repoPath),
  kanbanData: (repoPath: string) => taskQueryKeys.repoData(repoPath),
};

export const createRepoTaskDataQueryOptions = (listTasks: ListTasks) => (repoPath: string) =>
  queryOptions({
    queryKey: taskQueryKeys.repoData(repoPath),
    queryFn: async (): Promise<RepoTaskData> => ({
      tasks: await listTasks(repoPath),
    }),
    staleTime: TASK_DATA_STALE_TIME_MS,
  });

export const repoTaskDataQueryOptions = createRepoTaskDataQueryOptions((repoPath) =>
  host.tasksList(repoPath),
);

export const loadRepoTaskDataFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
): Promise<RepoTaskData> => queryClient.fetchQuery(repoTaskDataQueryOptions(repoPath));

const invalidateRepoTaskDataQueries = (
  queryClient: QueryClient,
  repoPath: string,
  options?: {
    refetchType?: "active" | "inactive" | "all" | "none";
  },
) => {
  const filters: Parameters<QueryClient["invalidateQueries"]>[0] = {
    queryKey: taskQueryKeys.repoDataPrefix(repoPath),
    exact: false,
  };
  if (options?.refetchType) {
    filters.refetchType = options.refetchType;
  }
  return queryClient.invalidateQueries(filters);
};

export const refetchActiveKanbanQueries = (
  queryClient: QueryClient,
  repoPath: string,
): Promise<void> =>
  queryClient.refetchQueries({
    queryKey: taskQueryKeys.repoDataPrefix(repoPath),
    exact: false,
    type: "active",
  });

const invalidateRepoTaskListQueries = (
  queryClient: QueryClient,
  repoPath: string,
  options?: {
    refetchType?: "active" | "inactive" | "all" | "none";
  },
) => {
  return invalidateRepoTaskDataQueries(queryClient, repoPath, options);
};

export const invalidateRepoTaskQueries = (
  queryClient: QueryClient,
  repoPath: string,
): Promise<void> => invalidateRepoTaskListQueries(queryClient, repoPath, { refetchType: "none" });
