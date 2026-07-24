import type { TaskCard } from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { hostClient as host } from "@/lib/host-client";

const TASK_DATA_STALE_TIME_MS = 30_000;

export type RepoTaskData = {
  tasks: TaskCard[];
};

export type ListTasks = (repoPath: string, doneVisibleDays: number) => Promise<TaskCard[]>;

export const taskQueryKeys = {
  all: ["tasks"] as const,
  repoDataPrefix: (repoPath: string) => [...taskQueryKeys.all, "repo-data", repoPath] as const,
  repoData: (repoPath: string, doneVisibleDays: number) =>
    [...taskQueryKeys.repoDataPrefix(repoPath), doneVisibleDays] as const,
  kanbanData: (repoPath: string, doneVisibleDays: number) =>
    taskQueryKeys.repoData(repoPath, doneVisibleDays),
};

export const createRepoTaskDataQueryOptions =
  (listTasks: ListTasks) => (repoPath: string, doneVisibleDays: number) =>
    queryOptions({
      queryKey: taskQueryKeys.repoData(repoPath, doneVisibleDays),
      queryFn: async (): Promise<RepoTaskData> => ({
        tasks: await listTasks(repoPath, doneVisibleDays),
      }),
      staleTime: TASK_DATA_STALE_TIME_MS,
    });

export const repoTaskDataQueryOptions = createRepoTaskDataQueryOptions(
  (repoPath, doneVisibleDays) => host.tasksList(repoPath, doneVisibleDays),
);

export const loadRepoTaskDataFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  doneVisibleDays: number,
): Promise<RepoTaskData> =>
  queryClient.fetchQuery(repoTaskDataQueryOptions(repoPath, doneVisibleDays));

const invalidateRepoTaskDataQueries = (
  queryClient: QueryClient,
  repoPath: string,
  options?: {
    refetchType?: "active" | "inactive" | "all" | "none";
  },
) => {
  return queryClient.invalidateQueries({
    queryKey: taskQueryKeys.repoDataPrefix(repoPath),
    exact: false,
    ...(options?.refetchType ? { refetchType: options.refetchType } : {}),
  });
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

const cachedKanbanQueryKeysForRepo = (
  queryClient: QueryClient,
  repoPath: string,
): Array<ReturnType<typeof taskQueryKeys.repoData>> =>
  queryClient
    .getQueryCache()
    .findAll({
      queryKey: taskQueryKeys.repoDataPrefix(repoPath),
      exact: false,
    })
    .reduce<Array<ReturnType<typeof taskQueryKeys.repoData>>>((keys, query) => {
      const queryKey = query.queryKey;
      if (
        queryKey[0] === taskQueryKeys.all[0] &&
        queryKey[1] === "repo-data" &&
        queryKey[2] === repoPath &&
        typeof queryKey[3] === "number" &&
        queryKey[3] >= 0
      ) {
        keys.push(queryKey as ReturnType<typeof taskQueryKeys.repoData>);
      }
      return keys;
    }, []);

export const refreshCachedKanbanQueries = async (
  queryClient: QueryClient,
  repoPath: string,
  options?: { force?: boolean; excludeDoneVisibleDays?: number },
): Promise<void> => {
  const cachedQueryKeys = cachedKanbanQueryKeysForRepo(queryClient, repoPath).filter(
    ([, , , doneVisibleDays]) => doneVisibleDays !== options?.excludeDoneVisibleDays,
  );
  const force = options?.force ?? true;
  await Promise.all(
    cachedQueryKeys.map(([, , , doneVisibleDays]) =>
      queryClient.fetchQuery({
        ...repoTaskDataQueryOptions(repoPath, doneVisibleDays),
        ...(force ? { staleTime: 0 } : {}),
      }),
    ),
  );
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
): Promise<unknown> =>
  invalidateRepoTaskListQueries(queryClient, repoPath, { refetchType: "none" });
