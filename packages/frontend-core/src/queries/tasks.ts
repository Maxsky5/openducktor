import type { TaskCard } from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import type { HostClient } from "@openducktor/host-client";
import { connectionHost } from "../connection/client-connection";

const TASK_DATA_STALE_TIME_MS = 30_000;

export type RepoTaskData = {
  tasks: TaskCard[];
};

export type ListTasks = (repoPath: string, queryClient: QueryClient) => Promise<TaskCard[]>;

export const taskQueryKeys = {
  all: ["tasks"] as const,
  repoDataPrefix: (repoPath: string) => [...taskQueryKeys.all, "repo-data", repoPath] as const,
  repoData: (repoPath: string) => taskQueryKeys.repoDataPrefix(repoPath),
  kanbanData: (repoPath: string) => taskQueryKeys.repoData(repoPath),
  unfilteredRepoData: (repoPath: string) =>
    [...taskQueryKeys.repoDataPrefix(repoPath), "unfiltered"] as const,
  /** Under the repository data prefix, so task events mark it stale with the task list. */
  ids: (repoPath: string) => [...taskQueryKeys.repoDataPrefix(repoPath), "ids"] as const,
};

export const createRepoTaskDataQueryOptions = (listTasks: ListTasks) => (repoPath: string) =>
  queryOptions({
    queryKey: taskQueryKeys.repoData(repoPath),
    queryFn: async ({ client }): Promise<RepoTaskData> => ({
      tasks: await listTasks(repoPath, client),
    }),
    staleTime: TASK_DATA_STALE_TIME_MS,
  });

export const repoTaskDataQueryOptions = createRepoTaskDataQueryOptions((repoPath, queryClient) =>
  connectionHost(queryClient).tasksList(repoPath),
);

export const unfilteredRepoTaskDataQueryOptions = (repoPath: string) =>
  queryOptions({
    queryKey: taskQueryKeys.unfilteredRepoData(repoPath),
    queryFn: async ({ client }): Promise<RepoTaskData> => ({
      tasks: await connectionHost(client).tasksListAll(repoPath),
    }),
    staleTime: TASK_DATA_STALE_TIME_MS,
  });

/** The IDs of all tasks of a repository, also closed tasks that the Kanban list hides. */
export const repoTaskIdsQueryOptions = (
  repoPath: string,
  readPort?: Pick<HostClient, "taskIdsList">,
) =>
  queryOptions({
    queryKey: taskQueryKeys.ids(repoPath),
    queryFn: ({ client }): Promise<string[]> =>
      (readPort ?? connectionHost(client)).taskIdsList(repoPath),
    staleTime: TASK_DATA_STALE_TIME_MS,
  });

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
