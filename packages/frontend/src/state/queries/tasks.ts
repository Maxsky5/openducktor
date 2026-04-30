import type { AgentSessionRecord, TaskCard } from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { hostClient as host } from "@/lib/host-client";
import { toVisibleTasks } from "../read-models/task-read-model";

const TASK_DATA_STALE_TIME_MS = 30_000;

export type RepoTaskData = {
  tasks: TaskCard[];
};

export const taskQueryKeys = {
  all: ["tasks"] as const,
  repoData: (repoPath: string) => [...taskQueryKeys.all, "repo-data", repoPath] as const,
  visibleTasks: (repoPath: string) => [...taskQueryKeys.all, "visible-tasks", repoPath] as const,
  kanbanDataPrefix: (repoPath: string) => [...taskQueryKeys.all, "kanban-data", repoPath] as const,
  kanbanData: (repoPath: string, doneVisibleDays: number) =>
    [...taskQueryKeys.kanbanDataPrefix(repoPath), doneVisibleDays] as const,
};

export const repoTaskDataQueryOptions = (repoPath: string) =>
  queryOptions({
    queryKey: taskQueryKeys.repoData(repoPath),
    queryFn: async (): Promise<RepoTaskData> => {
      return {
        tasks: toVisibleTasks(await host.tasksList(repoPath)),
      };
    },
    staleTime: TASK_DATA_STALE_TIME_MS,
  });

export const repoVisibleTasksQueryOptions = (repoPath: string) =>
  queryOptions({
    queryKey: taskQueryKeys.visibleTasks(repoPath),
    queryFn: async (): Promise<TaskCard[]> => {
      const taskList = await host.tasksList(repoPath);
      return toVisibleTasks(taskList);
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

export const loadRepoTaskDataFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
): Promise<RepoTaskData> =>
  queryClient.fetchQuery({
    ...repoTaskDataQueryOptions(repoPath),
    queryFn: async (): Promise<RepoTaskData> => {
      const repoTaskData = {
        tasks: toVisibleTasks(await host.tasksList(repoPath)),
      };
      queryClient.setQueryData(taskQueryKeys.visibleTasks(repoPath), repoTaskData.tasks);
      return repoTaskData;
    },
  });

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
    queryClient.invalidateQueries({
      queryKey: taskQueryKeys.visibleTasks(repoPath),
      exact: true,
      ...(options?.refetchType ? { refetchType: options.refetchType } : {}),
    }),
    invalidateKanbanTaskQueries(queryClient, repoPath, options),
  ]);
};

export const invalidateRepoTaskQueries = (
  queryClient: QueryClient,
  repoPath: string,
): Promise<unknown[]> =>
  Promise.all([invalidateRepoTaskListQueries(queryClient, repoPath, { refetchType: "none" })]);

export const upsertAgentSessionInRepoTaskData = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  session: AgentSessionRecord,
): void => {
  const updateTasks = (current: TaskCard[] | undefined): TaskCard[] | undefined => {
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
        (entry) => entry.externalSessionId === session.externalSessionId,
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

    return didChange ? nextTasks : current;
  };

  const updateRepoTaskData = (current: RepoTaskData | undefined): RepoTaskData | undefined => {
    if (!current) {
      return current;
    }

    const nextTasks = updateTasks(current.tasks);
    if (!nextTasks || nextTasks === current.tasks) {
      return current;
    }

    return { ...current, tasks: nextTasks };
  };

  queryClient.setQueryData<RepoTaskData | undefined>(
    taskQueryKeys.repoData(repoPath),
    updateRepoTaskData,
  );
  queryClient.setQueryData<TaskCard[] | undefined>(
    taskQueryKeys.visibleTasks(repoPath),
    updateTasks,
  );
  queryClient.setQueriesData<TaskCard[] | undefined>(
    {
      queryKey: taskQueryKeys.kanbanDataPrefix(repoPath),
      exact: false,
    },
    (current): TaskCard[] | undefined => updateTasks(current),
  );
};
