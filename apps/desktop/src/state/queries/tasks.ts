import type { AgentSessionRecord, RunSummary, TaskCard } from "@openducktor/contracts";
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
  repoDataPrefix: (repoPath: string) => [...taskQueryKeys.all, "repo-data", repoPath] as const,
  repoData: (repoPath: string, doneVisibleDays: number) =>
    [...taskQueryKeys.repoDataPrefix(repoPath), doneVisibleDays] as const,
  runs: (repoPath: string) => [...taskQueryKeys.all, "runs", repoPath] as const,
};

export const repoTaskDataQueryOptions = (repoPath: string, doneVisibleDays: number) =>
  queryOptions({
    queryKey: taskQueryKeys.repoData(repoPath, doneVisibleDays),
    queryFn: async (): Promise<RepoTaskData> => {
      const [taskList, runList] = await Promise.all([
        host.tasksList(repoPath, doneVisibleDays),
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
  doneVisibleDays: number,
): Promise<RepoTaskData> =>
  queryClient.fetchQuery({
    ...repoTaskDataQueryOptions(repoPath, doneVisibleDays),
    queryFn: async (): Promise<RepoTaskData> => {
      const [taskList, runList] = await Promise.all([
        host.tasksList(repoPath, doneVisibleDays),
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

export const invalidateRepoTaskDataQueries = (
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

export const invalidateRepoTaskQueries = (
  queryClient: QueryClient,
  repoPath: string,
): Promise<unknown[]> => {
  return Promise.all([
    invalidateRepoTaskDataQueries(queryClient, repoPath, { refetchType: "none" }),
    queryClient.invalidateQueries({
      queryKey: taskQueryKeys.runs(repoPath),
      exact: true,
      refetchType: "none",
    }),
  ]);
};

export const upsertAgentSessionInRepoTaskData = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  session: AgentSessionRecord,
): void => {
  queryClient.setQueriesData<RepoTaskData | undefined>(
    {
      queryKey: taskQueryKeys.repoDataPrefix(repoPath),
      exact: false,
    },
    (current): RepoTaskData | undefined => {
      if (!current) {
        return current;
      }

      let didChange = false;
      const nextTasks = current.tasks.map((task) => {
        if (task.id !== taskId) {
          return task;
        }

        const currentAgentSessions = task.agentSessions ?? [];
        const existingIndex = currentAgentSessions.findIndex(
          (entry) => entry.sessionId === session.sessionId,
        );
        const existingSession =
          existingIndex === -1 ? null : (currentAgentSessions[existingIndex] ?? null);
        if (existingSession === session) {
          return task;
        }

        const nextAgentSessions =
          existingIndex === -1
            ? [...currentAgentSessions, session]
            : currentAgentSessions.map((entry, index) =>
                index === existingIndex ? session : entry,
              );

        didChange = true;
        return {
          ...task,
          agentSessions: nextAgentSessions,
        };
      });

      return didChange ? { ...current, tasks: nextTasks } : current;
    },
  );
};
