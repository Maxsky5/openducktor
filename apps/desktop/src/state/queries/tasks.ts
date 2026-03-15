import type { RunSummary, TaskCard } from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { hostClient as host } from "@/lib/host-client";
import { toVisibleTasks } from "../read-models/task-read-model";

const TASK_DATA_STALE_TIME_MS = 30_000;
const RUN_DATA_STALE_TIME_MS = 30_000;

type RepoTaskData = {
  tasks: TaskCard[];
  runs: RunSummary[];
};

export const taskQueryKeys = {
  all: ["tasks"] as const,
  repoData: (repoPath: string) => [...taskQueryKeys.all, "repo-data", repoPath] as const,
  runs: (repoPath: string) => [...taskQueryKeys.all, "runs", repoPath] as const,
};

const repoTaskDataQueryOptions = (repoPath: string) =>
  queryOptions({
    queryKey: taskQueryKeys.repoData(repoPath),
    queryFn: async (): Promise<RepoTaskData> => {
      const [taskList, runList] = await Promise.all([
        host.tasksList(repoPath),
        host.runsList(repoPath),
      ]);

      return {
        tasks: toVisibleTasks(taskList),
        runs: runList,
      };
    },
    staleTime: TASK_DATA_STALE_TIME_MS,
  });

const repoRunsQueryOptions = (repoPath: string) =>
  queryOptions({
    queryKey: taskQueryKeys.runs(repoPath),
    queryFn: (): Promise<RunSummary[]> => host.runsList(repoPath),
    staleTime: RUN_DATA_STALE_TIME_MS,
  });

export const loadRepoTaskDataFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
): Promise<RepoTaskData> =>
  queryClient.fetchQuery({
    ...repoTaskDataQueryOptions(repoPath),
    queryFn: async (): Promise<RepoTaskData> => {
      const [taskList, runList] = await Promise.all([
        host.tasksList(repoPath),
        host.runsList(repoPath),
      ]);
      const repoTaskData = {
        tasks: toVisibleTasks(taskList),
        runs: runList,
      };
      queryClient.setQueryData(taskQueryKeys.runs(repoPath), repoTaskData.runs);
      return repoTaskData;
    },
  });

export const loadRepoRunsFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
): Promise<RunSummary[]> => queryClient.fetchQuery(repoRunsQueryOptions(repoPath));
