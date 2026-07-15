import type { AgentSessionRecord } from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { host } from "../operations/host";

const AGENT_SESSION_LIST_STALE_TIME = Number.POSITIVE_INFINITY;

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
      "hydrate-missing-lists",
      repoPath,
      normalizeAgentSessionTaskIds(taskIds),
    ] as const,
};

export const agentSessionListQueryOptions = (repoPath: string, taskId: string) =>
  queryOptions({
    queryKey: agentSessionQueryKeys.list(repoPath, taskId),
    queryFn: (): Promise<AgentSessionRecord[]> => host.agentSessionsList(repoPath, taskId),
    staleTime: AGENT_SESSION_LIST_STALE_TIME,
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

  const requestedTaskIds = new Set(normalizedTaskIds);
  const initialUpdateCounts = new Map(
    normalizedTaskIds.map((taskId) => [
      taskId,
      queryClient.getQueryState(agentSessionQueryKeys.list(repoPath, taskId))?.dataUpdateCount ?? 0,
    ]),
  );
  const taskSessions = await host.agentSessionsListForTasks(repoPath, normalizedTaskIds);
  const sessionsByTaskId = new Map<string, AgentSessionRecord[]>();
  for (const taskSession of taskSessions) {
    if (!requestedTaskIds.has(taskSession.taskId)) {
      throw new Error(`Batch session response included unexpected task "${taskSession.taskId}".`);
    }
    if (sessionsByTaskId.has(taskSession.taskId)) {
      throw new Error(
        `Batch session response included task "${taskSession.taskId}" more than once.`,
      );
    }
    sessionsByTaskId.set(taskSession.taskId, taskSession.agentSessions);
  }

  const missingTaskId = normalizedTaskIds.find((taskId) => !sessionsByTaskId.has(taskId));
  if (missingTaskId) {
    throw new Error(`Batch session response omitted task "${missingTaskId}".`);
  }

  for (const taskId of normalizedTaskIds) {
    const queryKey = agentSessionQueryKeys.list(repoPath, taskId);
    const currentState = queryClient.getQueryState(queryKey);
    const updateCountChanged =
      (currentState?.dataUpdateCount ?? 0) !== initialUpdateCounts.get(taskId);
    if (updateCountChanged || currentState?.isInvalidated) {
      continue;
    }
    queryClient.setQueryData(queryKey, sessionsByTaskId.get(taskId));
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
    staleTime: AGENT_SESSION_LIST_STALE_TIME,
    gcTime: 0,
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

  const taskIdsToHydrate = options?.forceFresh
    ? normalizedTaskIds
    : normalizedTaskIds.filter(
        (taskId) =>
          queryClient.getQueryData(agentSessionQueryKeys.list(repoPath, taskId)) === undefined,
      );
  if (taskIdsToHydrate.length > 0) {
    await queryClient.fetchQuery({
      ...agentSessionListHydrationQueryOptions(queryClient, repoPath, taskIdsToHydrate),
      ...(options?.forceFresh ? { staleTime: 0 } : {}),
    });
  }

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
    refetchType?: "active" | "all";
  },
): Promise<void> =>
  queryClient.invalidateQueries({
    queryKey: agentSessionQueryKeys.list(repoPath, taskId),
    exact: true,
    refetchType: options?.refetchType ?? "none",
  });
