import { workspaceScopeValue } from "./workspace-scope";
import type { WorkspaceRef } from "@openducktor/contracts";
import { type QueryClient, type QueryKey, queryOptions } from "@tanstack/react-query";
import type { HostClient } from "@openducktor/host-client";
import { connectionHost } from "../connection/client-connection";
import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";

const TASK_DATA_STALE_TIME_MS = 30_000;

export type RepoTaskData = {
  tasks: TaskCard[];
};

export type ListTasks = (scope: WorkspaceRef, queryClient: QueryClient) => Promise<TaskCard[]>;

export const taskQueryKeys = {
  all: ["tasks"] as const,
  skippedBoard: ["tasks", "skipped", "board"] as const,
  skippedComplete: ["tasks", "skipped", "complete"] as const,
  repoDataPrefix: (scope: WorkspaceRef) =>
    [...taskQueryKeys.all, "repo-data", workspaceScopeValue(scope)] as const,
  repoData: (scope: WorkspaceRef) => taskQueryKeys.repoDataPrefix(scope),
  kanbanData: (scope: WorkspaceRef) => taskQueryKeys.repoData(scope),
  unfilteredRepoData: (scope: WorkspaceRef) =>
    [...taskQueryKeys.repoDataPrefix(scope), "unfiltered"] as const,
  /** Under the repository data prefix, so task events mark it stale with the task list. */
  ids: (scope: WorkspaceRef) => [...taskQueryKeys.repoDataPrefix(scope), "ids"] as const,
};

export const createRepoTaskDataQueryOptions = (listTasks: ListTasks) => (scope: WorkspaceRef) =>
  queryOptions<RepoTaskData, Error, RepoTaskData, QueryKey>({
    queryKey: taskQueryKeys.repoData(scope),
    queryFn: async ({ client }): Promise<RepoTaskData> => ({
      tasks: await listTasks(scope, client),
    }),
    staleTime: TASK_DATA_STALE_TIME_MS,
  });

export const repoTaskDataQueryOptions = createRepoTaskDataQueryOptions((scope, queryClient) =>
  connectionHost(queryClient).tasksList(scope),
);

export const unfilteredRepoTaskDataQueryOptions = (scope: WorkspaceRef) =>
  queryOptions<RepoTaskData, Error, RepoTaskData, QueryKey>({
    queryKey: taskQueryKeys.unfilteredRepoData(scope),
    queryFn: async ({ client }): Promise<RepoTaskData> => ({
      tasks: await connectionHost(client).tasksListAll(scope),
    }),
    staleTime: TASK_DATA_STALE_TIME_MS,
  });

/** The IDs of all tasks of a repository, also closed tasks that the Kanban list hides. */
export const repoTaskIdsQueryOptions = (
  scope: WorkspaceRef,
  readPort?: Pick<HostClient, "taskIdsList">,
) =>
  queryOptions({
    queryKey: taskQueryKeys.ids(scope),
    queryFn: ({ client }): Promise<string[]> =>
      (readPort ?? connectionHost(client)).taskIdsList(scope),
    staleTime: TASK_DATA_STALE_TIME_MS,
  });

export const loadRepoTaskDataFromQuery = (
  queryClient: QueryClient,
  scope: WorkspaceRef,
): Promise<RepoTaskData> => queryClient.fetchQuery(repoTaskDataQueryOptions(scope));

const invalidateRepoTaskDataQueries = (
  queryClient: QueryClient,
  scope: WorkspaceRef,
  options?: {
    refetchType?: "active" | "inactive" | "all" | "none";
  },
) => {
  const filters: Parameters<QueryClient["invalidateQueries"]>[0] = {
    queryKey: taskQueryKeys.repoDataPrefix(scope),
    exact: false,
  };
  if (options?.refetchType) {
    filters.refetchType = options.refetchType;
  }
  return queryClient.invalidateQueries(filters);
};

const invalidateRepoTaskListQueries = (
  queryClient: QueryClient,
  scope: WorkspaceRef,
  options?: {
    refetchType?: "active" | "inactive" | "all" | "none";
  },
) => {
  return invalidateRepoTaskDataQueries(queryClient, scope, options);
};

export const invalidateRepoTaskQueries = (
  queryClient: QueryClient,
  scope: WorkspaceRef,
): Promise<void> => invalidateRepoTaskListQueries(queryClient, scope, { refetchType: "none" });
