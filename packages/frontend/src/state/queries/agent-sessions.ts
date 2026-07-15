import type { AgentSessionRecord } from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { host } from "../operations/host";

const AGENT_SESSION_LIST_STALE_TIME = Number.POSITIVE_INFINITY;
const invalidationVersionsByQueryClient = new WeakMap<QueryClient, Map<string, number>>();

export type AgentSessionReadPort = Pick<
  typeof host,
  "agentSessionsList" | "agentSessionsListForTasks"
>;

const agentSessionInvalidationVersionKey = (repoPath: string, taskId: string): string =>
  JSON.stringify([repoPath, taskId]);

const getAgentSessionInvalidationVersion = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
): number =>
  invalidationVersionsByQueryClient
    .get(queryClient)
    ?.get(agentSessionInvalidationVersionKey(repoPath, taskId)) ?? 0;

const incrementAgentSessionInvalidationVersion = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
): void => {
  const versions = invalidationVersionsByQueryClient.get(queryClient) ?? new Map<string, number>();
  const versionKey = agentSessionInvalidationVersionKey(repoPath, taskId);
  versions.set(versionKey, (versions.get(versionKey) ?? 0) + 1);
  invalidationVersionsByQueryClient.set(queryClient, versions);
};

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

export const agentSessionListQueryOptions = (
  repoPath: string,
  taskId: string,
  readPort: AgentSessionReadPort = host,
) =>
  queryOptions({
    queryKey: agentSessionQueryKeys.list(repoPath, taskId),
    queryFn: (): Promise<AgentSessionRecord[]> => readPort.agentSessionsList(repoPath, taskId),
    staleTime: AGENT_SESSION_LIST_STALE_TIME,
  });

export const hydrateAgentSessionListQueries = async (
  queryClient: QueryClient,
  repoPath: string,
  taskIds: string[],
  readPort: AgentSessionReadPort = host,
): Promise<void> => {
  const normalizedTaskIds = normalizeAgentSessionTaskIds(taskIds);
  if (normalizedTaskIds.length === 0) {
    return;
  }

  const requestedTaskIds = new Set(normalizedTaskIds);
  const initialQueryStates = new Map(
    normalizedTaskIds.map((taskId) => [
      taskId,
      queryClient.getQueryState(agentSessionQueryKeys.list(repoPath, taskId)),
    ]),
  );
  const initialInvalidationVersions = new Map(
    normalizedTaskIds.map((taskId) => [
      taskId,
      getAgentSessionInvalidationVersion(queryClient, repoPath, taskId),
    ]),
  );
  const taskSessions = await readPort.agentSessionsListForTasks(repoPath, normalizedTaskIds);
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
    const initialState = initialQueryStates.get(taskId);
    const currentState = queryClient.getQueryState(queryKey);
    const generationChanged =
      (currentState?.dataUpdateCount ?? 0) !== (initialState?.dataUpdateCount ?? 0) ||
      (currentState?.errorUpdateCount ?? 0) !== (initialState?.errorUpdateCount ?? 0);
    const invalidatedAfterBatchStarted =
      initialState?.isInvalidated !== true && currentState?.isInvalidated === true;
    const invalidationVersionChanged =
      getAgentSessionInvalidationVersion(queryClient, repoPath, taskId) !==
      initialInvalidationVersions.get(taskId);
    if (generationChanged || invalidatedAfterBatchStarted || invalidationVersionChanged) {
      continue;
    }
    queryClient.setQueryData(queryKey, sessionsByTaskId.get(taskId));
  }
};

export const agentSessionListHydrationQueryOptions = (
  queryClient: QueryClient,
  repoPath: string,
  taskIds: string[],
  readPort: AgentSessionReadPort = host,
) => {
  const queryKey = agentSessionQueryKeys.hydration(repoPath, taskIds);
  const normalizedTaskIds = queryKey[3];
  return queryOptions({
    queryKey,
    queryFn: async (): Promise<true> => {
      await hydrateAgentSessionListQueries(queryClient, repoPath, normalizedTaskIds, readPort);
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
    readPort?: AgentSessionReadPort;
  },
): Promise<AgentSessionRecord[]> =>
  queryClient.fetchQuery({
    ...agentSessionListQueryOptions(repoPath, taskId, options?.readPort),
    ...(options?.forceFresh ? { staleTime: 0 } : {}),
  });

export const loadAgentSessionListsFromQuery = async (
  queryClient: QueryClient,
  repoPath: string,
  taskIds: string[],
  options?: {
    forceFresh?: boolean;
    readPort?: AgentSessionReadPort;
  },
): Promise<Record<string, AgentSessionRecord[]>> => {
  const normalizedTaskIds = normalizeAgentSessionTaskIds(taskIds);
  if (normalizedTaskIds.length === 0) {
    return {};
  }

  const taskIdsToHydrate = normalizedTaskIds.filter((taskId) => {
    const queryKey = agentSessionQueryKeys.list(repoPath, taskId);
    return (
      options?.forceFresh === true ||
      queryClient.getQueryData(queryKey) === undefined ||
      queryClient.getQueryState(queryKey)?.isInvalidated === true
    );
  });
  if (taskIdsToHydrate.length > 0) {
    const refreshesInvalidatedData = taskIdsToHydrate.some(
      (taskId) =>
        queryClient.getQueryState(agentSessionQueryKeys.list(repoPath, taskId))?.isInvalidated ===
        true,
    );
    await queryClient.fetchQuery({
      ...agentSessionListHydrationQueryOptions(
        queryClient,
        repoPath,
        taskIdsToHydrate,
        options?.readPort,
      ),
      ...(options?.forceFresh || refreshesInvalidatedData ? { staleTime: 0 } : {}),
    });
  }

  const entries = normalizedTaskIds.map((taskId) => {
    const queryKey = agentSessionQueryKeys.list(repoPath, taskId);
    const records = queryClient.getQueryData<AgentSessionRecord[]>(queryKey);
    if (!records) {
      throw new Error(`Batch session hydration did not populate task "${taskId}".`);
    }
    if (queryClient.getQueryState(queryKey)?.isInvalidated === true) {
      throw new Error(`Batch session hydration for task "${taskId}" was superseded.`);
    }
    return [taskId, records] as const;
  });

  return Object.fromEntries(entries);
};

export const invalidateAgentSessionListQuery = async (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  options?: {
    refetchType?: "active" | "all";
  },
): Promise<void> => {
  const queryKey = agentSessionQueryKeys.list(repoPath, taskId);
  const initialState = queryClient.getQueryState(queryKey);
  incrementAgentSessionInvalidationVersion(queryClient, repoPath, taskId);
  await queryClient.invalidateQueries({
    queryKey,
    exact: true,
    refetchType: options?.refetchType ?? "none",
  });
  const currentState = queryClient.getQueryState(queryKey);
  const refetchCompleted =
    (currentState?.dataUpdateCount ?? 0) !== (initialState?.dataUpdateCount ?? 0) ||
    (currentState?.errorUpdateCount ?? 0) !== (initialState?.errorUpdateCount ?? 0);
  const disabledRefetchWasSkipped =
    options?.refetchType === "all" &&
    initialState !== undefined &&
    currentState?.isInvalidated === true &&
    !refetchCompleted;
  if (disabledRefetchWasSkipped) {
    await queryClient.prefetchQuery({ queryKey, staleTime: 0 });
  }
};
