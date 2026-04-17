import type { AgentSessionRecord, RunSummary, TaskCard } from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { hostClient as host } from "@/lib/host-client";
import { toVisibleTasks } from "../read-models/task-read-model";

const TASK_DATA_STALE_TIME_MS = 30_000;
const RUN_DATA_STALE_TIME_MS = 30_000;

export type RepoTaskData = {
  tasks: TaskCard[];
  runs: RunSummary[];
};

export const taskQueryKeys = {
  all: ["tasks"] as const,
  repoData: (repoPath: string) => [...taskQueryKeys.all, "repo-data", repoPath] as const,
  kanbanDataPrefix: (repoPath: string) => [...taskQueryKeys.all, "kanban-data", repoPath] as const,
  kanbanData: (repoPath: string, doneVisibleDays: number) =>
    [...taskQueryKeys.kanbanDataPrefix(repoPath), doneVisibleDays] as const,
  runs: (repoPath: string) => [...taskQueryKeys.all, "runs", repoPath] as const,
};

export const repoTaskDataQueryOptions = (repoPath: string) =>
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

export const kanbanTaskListQueryOptions = (repoPath: string, doneVisibleDays: number) =>
  queryOptions({
    queryKey: taskQueryKeys.kanbanData(repoPath, doneVisibleDays),
    queryFn: async (): Promise<TaskCard[]> => {
      const taskList = await host.tasksList(repoPath, doneVisibleDays);
      return toVisibleTasks(taskList);
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

export const invalidateRepoTaskDataQueries = (
  queryClient: QueryClient,
  repoPath: string,
  options?: {
    refetchType?: "active" | "inactive" | "all" | "none";
  },
) => {
  return queryClient.invalidateQueries({
    queryKey: taskQueryKeys.repoData(repoPath),
    exact: true,
    ...(options?.refetchType ? { refetchType: options.refetchType } : {}),
  });
};

export const invalidateKanbanTaskQueries = (
  queryClient: QueryClient,
  repoPath: string,
  options?: {
    refetchType?: "active" | "inactive" | "all" | "none";
  },
) => {
  return queryClient.invalidateQueries({
    queryKey: taskQueryKeys.kanbanDataPrefix(repoPath),
    exact: false,
    ...(options?.refetchType ? { refetchType: options.refetchType } : {}),
  });
};

export const refetchActiveKanbanQueries = (
  queryClient: QueryClient,
  repoPath: string,
): Promise<void> =>
  queryClient.refetchQueries({
    queryKey: taskQueryKeys.kanbanDataPrefix(repoPath),
    exact: false,
    type: "active",
  });

const cachedKanbanQueryKeysForRepo = (
  queryClient: QueryClient,
  repoPath: string,
): Array<ReturnType<typeof taskQueryKeys.kanbanData>> =>
  queryClient
    .getQueryCache()
    .findAll({
      queryKey: taskQueryKeys.kanbanDataPrefix(repoPath),
      exact: false,
    })
    .map((query) => query.queryKey)
    .filter(
      (queryKey): queryKey is ReturnType<typeof taskQueryKeys.kanbanData> =>
        queryKey[0] === taskQueryKeys.all[0] &&
        queryKey[1] === "kanban-data" &&
        queryKey[2] === repoPath &&
        typeof queryKey[3] === "number",
    );

export const refreshCachedKanbanQueries = async (
  queryClient: QueryClient,
  repoPath: string,
): Promise<void> => {
  const cachedQueryKeys = cachedKanbanQueryKeysForRepo(queryClient, repoPath);
  await Promise.all(
    cachedQueryKeys.map(([, , , doneVisibleDays]) =>
      queryClient.fetchQuery({
        ...kanbanTaskListQueryOptions(repoPath, doneVisibleDays),
        staleTime: 0,
      }),
    ),
  );
};

export const invalidateRepoTaskListQueries = (
  queryClient: QueryClient,
  repoPath: string,
  options?: {
    refetchType?: "active" | "inactive" | "all" | "none";
  },
) => {
  return Promise.all([
    invalidateRepoTaskDataQueries(queryClient, repoPath, options),
    invalidateKanbanTaskQueries(queryClient, repoPath, options),
  ]);
};

export const invalidateRepoTaskQueries = (
  queryClient: QueryClient,
  repoPath: string,
): Promise<unknown[]> => {
  return Promise.all([
    invalidateRepoTaskListQueries(queryClient, repoPath, { refetchType: "none" }),
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
  const updateRepoTaskData = (current: RepoTaskData | undefined): RepoTaskData | undefined => {
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
          : currentAgentSessions.map((entry, index) => (index === existingIndex ? session : entry));

      didChange = true;
      return {
        ...task,
        agentSessions: nextAgentSessions,
      };
    });

    return didChange ? { ...current, tasks: nextTasks } : current;
  };

  queryClient.setQueryData<RepoTaskData | undefined>(
    taskQueryKeys.repoData(repoPath),
    updateRepoTaskData,
  );
  queryClient.setQueriesData<TaskCard[] | undefined>(
    {
      queryKey: taskQueryKeys.kanbanDataPrefix(repoPath),
      exact: false,
    },
    (current): TaskCard[] | undefined => {
      if (!current) {
        return current;
      }

      let didChange = false;
      const nextTasks = current.map((task) => {
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

      return didChange ? nextTasks : current;
    },
  );
};
