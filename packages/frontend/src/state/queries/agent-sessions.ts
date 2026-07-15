import type { AgentSessionRecord } from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { host } from "../operations/host";

const AGENT_SESSION_LIST_STALE_TIME_MS = 30_000;

export const normalizeAgentSessionTaskIds = (taskIds: string[]): string[] =>
  Array.from(
    new Set(
      taskIds.flatMap((taskId) => {
        const normalizedTaskId = taskId.trim();
        return normalizedTaskId ? [normalizedTaskId] : [];
      }),
    ),
  ).sort();

export const agentSessionQueryKeys = {
  all: ["agent-sessions"] as const,
  list: (repoPath: string, taskId: string) =>
    [...agentSessionQueryKeys.all, "list", repoPath, taskId] as const,
  hydration: (repoPath: string, taskIds: string[]) =>
    [
      ...agentSessionQueryKeys.all,
      "hydrate-lists",
      repoPath,
      normalizeAgentSessionTaskIds(taskIds),
    ] as const,
};

export const agentSessionListQueryOptions = (repoPath: string, taskId: string) =>
  queryOptions({
    queryKey: agentSessionQueryKeys.list(repoPath, taskId),
    queryFn: (): Promise<AgentSessionRecord[]> => host.agentSessionsList(repoPath, taskId),
    staleTime: AGENT_SESSION_LIST_STALE_TIME_MS,
  });

export const hydrateAgentSessionListQueries = async (
  queryClient: QueryClient,
  repoPath: string,
  taskIds: string[],
): Promise<void> => {
  const normalizedTaskIds = normalizeAgentSessionTaskIds(taskIds);
  if (normalizedTaskIds.length === 0) {
    return;
  }

  const sessionsByTaskId = new Map<string, AgentSessionRecord[]>(
    normalizedTaskIds.map((taskId) => [taskId, []]),
  );
  const taskSessions = await host.agentSessionsListForTasks(repoPath, normalizedTaskIds);
  for (const taskSession of taskSessions) {
    if (sessionsByTaskId.has(taskSession.taskId)) {
      sessionsByTaskId.set(taskSession.taskId, taskSession.agentSessions);
    }
  }

  const updatedAt = Date.now();
  for (const [taskId, sessions] of sessionsByTaskId) {
    queryClient.setQueryData(agentSessionQueryKeys.list(repoPath, taskId), sessions, { updatedAt });
  }
};

export const agentSessionListHydrationQueryOptions = (
  queryClient: QueryClient,
  repoPath: string,
  taskIds: string[],
) => {
  const queryKey = agentSessionQueryKeys.hydration(repoPath, taskIds);
  const normalizedTaskIds = queryKey[3];
  return queryOptions({
    queryKey,
    queryFn: async (): Promise<true> => {
      await hydrateAgentSessionListQueries(queryClient, repoPath, normalizedTaskIds);
      return true;
    },
    staleTime: AGENT_SESSION_LIST_STALE_TIME_MS,
  });
};

export const loadAgentSessionListFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  options?: {
    forceFresh?: boolean;
  },
): Promise<AgentSessionRecord[]> =>
  queryClient.fetchQuery({
    ...agentSessionListQueryOptions(repoPath, taskId),
    ...(options?.forceFresh ? { staleTime: 0 } : {}),
  });

export const loadAgentSessionListsFromQuery = async (
  queryClient: QueryClient,
  repoPath: string,
  taskIds: string[],
  options?: {
    forceFresh?: boolean;
  },
): Promise<Record<string, AgentSessionRecord[]>> => {
  const normalizedTaskIds = normalizeAgentSessionTaskIds(taskIds);
  if (normalizedTaskIds.length === 0) {
    return {};
  }

  const hasMissingList = normalizedTaskIds.some(
    (taskId) =>
      queryClient.getQueryData(agentSessionQueryKeys.list(repoPath, taskId)) === undefined,
  );
  await queryClient.fetchQuery({
    ...agentSessionListHydrationQueryOptions(queryClient, repoPath, normalizedTaskIds),
    ...(options?.forceFresh || hasMissingList ? { staleTime: 0 } : {}),
  });

  const entries = normalizedTaskIds.map((taskId) => {
    const records = queryClient.getQueryData<AgentSessionRecord[]>(
      agentSessionQueryKeys.list(repoPath, taskId),
    );
    if (!records) {
      throw new Error(`Batch session hydration did not populate task "${taskId}".`);
    }
    return [taskId, records] as const;
  });

  return Object.fromEntries(entries);
};

export const invalidateAgentSessionListQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  options?: {
    refetchActive?: boolean;
  },
): Promise<void> =>
  queryClient.invalidateQueries({
    queryKey: agentSessionQueryKeys.list(repoPath, taskId),
    exact: true,
    refetchType: options?.refetchActive === true ? "active" : "none",
  });
