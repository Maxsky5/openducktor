import type {
  AgentSessionLiveEnvelope,
  AgentSessionRecord,
  TaskAgentSessions,
} from "@openducktor/contracts";
import { isCancelledError, type QueryClient, queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { host } from "../operations/host";
import { getAgentSessionListBatch } from "./agent-session-list-batch";

const AGENT_SESSION_LIST_STALE_TIME = Number.POSITIVE_INFINITY;
const queryKeyStringSchema = z.string();

export type AgentSessionReadPort = Pick<typeof host, "agentSessionsListForTasks">;

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
};

/** A committed host update replaces the full task list and completes the reads in progress. */
export const updateAgentSessionListQuery = (
  queryClient: QueryClient,
  repoPath: string,
  records: TaskAgentSessions,
): void => {
  getAgentSessionListBatch(queryClient).settle(repoPath, records);
  queryClient.setQueryData(
    agentSessionQueryKeys.list(repoPath, records.taskId),
    records.agentSessions,
  );
};

/** Each task has its own list query. Reads of one workspace share one host request. */
export const agentSessionListQueryOptions = (
  repoPath: string,
  taskId: string,
  readPort: AgentSessionReadPort = host,
) =>
  queryOptions({
    queryKey: agentSessionQueryKeys.list(repoPath, taskId),
    queryFn: ({ client }): Promise<AgentSessionRecord[]> =>
      getAgentSessionListBatch(client).load(repoPath, taskId, readPort),
    retryOnMount: false,
    staleTime: AGENT_SESSION_LIST_STALE_TIME,
  });

export const loadAgentSessionListFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  options?: {
    forceFresh?: boolean;
    readPort?: AgentSessionReadPort;
  },
): Promise<AgentSessionRecord[]> => {
  const query = agentSessionListQueryOptions(repoPath, taskId, options?.readPort);
  return queryClient.fetchQuery(options?.forceFresh ? { ...query, staleTime: 0 } : query);
};

export const loadAgentSessionListsFromQuery = async (
  queryClient: QueryClient,
  repoPath: string,
  taskIds: string[],
  options?: {
    forceFresh?: boolean;
    readPort?: AgentSessionReadPort;
  },
): Promise<Record<string, AgentSessionRecord[]>> => {
  const entries = await Promise.all(
    normalizeAgentSessionTaskIds(taskIds).map(
      async (taskId) =>
        [
          taskId,
          await loadAgentSessionListFromQuery(queryClient, repoPath, taskId, options),
        ] as const,
    ),
  );
  return Object.fromEntries(entries);
};

export const retryAgentSessionListQueries = async (
  queryClient: QueryClient,
  repoPath: string,
  taskIds: string[],
  readPort: AgentSessionReadPort = host,
): Promise<void> => {
  const taskIdsToRetry = normalizeAgentSessionTaskIds(taskIds).filter((taskId) => {
    const queryKey = agentSessionQueryKeys.list(repoPath, taskId);
    const queryState = queryClient.getQueryState(queryKey);
    return (
      queryState?.status === "error" ||
      queryState?.isInvalidated === true ||
      queryClient.getQueryData(queryKey) === undefined
    );
  });
  await loadAgentSessionListsFromQuery(queryClient, repoPath, taskIdsToRetry, {
    forceFresh: true,
    readPort,
  });
};

/** Cancel every session-list read before a stream snapshot replaces the lists. */
export const cancelAgentSessionListReads = (queryClient: QueryClient): Promise<void> => {
  const cancelled = queryClient.cancelQueries({
    queryKey: agentSessionQueryKeys.all,
    exact: false,
  });
  // Cancelled reads must not reach the host. A deleted task fails the whole batch request.
  getAgentSessionListBatch(queryClient).dropAll();
  return cancelled;
};

export const removeAgentSessionListQueries = async (
  queryClient: QueryClient,
  repoPath: string,
  taskIds: string[],
): Promise<void> => {
  const normalizedTaskIds = normalizeAgentSessionTaskIds(taskIds);
  const queryKeys = normalizedTaskIds.map((taskId) => agentSessionQueryKeys.list(repoPath, taskId));
  const cancelled = Promise.all(
    queryKeys.map((queryKey) => queryClient.cancelQueries({ queryKey, exact: true })),
  );
  getAgentSessionListBatch(queryClient).drop(repoPath, normalizedTaskIds);
  await cancelled;
  for (const queryKey of queryKeys) {
    const query = queryClient.getQueryCache().find({ queryKey, exact: true });
    if (query && query.getObserversCount() > 0) {
      queryClient.setQueryData(queryKey, []);
    } else {
      queryClient.removeQueries({ queryKey, exact: true });
    }
  }
};

/** Read current records for one task, also when no view observes its list. */
export const refreshAgentSessionListQuery = async (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  readPort: AgentSessionReadPort = host,
): Promise<void> => {
  getAgentSessionListBatch(queryClient).markStale(repoPath, [taskId]);
  try {
    await loadAgentSessionListFromQuery(queryClient, repoPath, taskId, {
      forceFresh: true,
      readPort,
    });
  } catch (error) {
    // A task deletion or a stream snapshot cancels the read and owns the list.
    if (!isCancelledError(error)) {
      throw error;
    }
  }
};

/**
 * Read again the changed lists that a view observes. The other changed lists stay stale until
 * a view needs them. Returns true when the session membership or ownership changed.
 */
export const refreshAgentSessionLists = async (
  queryClient: QueryClient,
  repoPath: string,
  taskIds: string[],
): Promise<boolean> => {
  const normalizedTaskIds = normalizeAgentSessionTaskIds(taskIds);
  const queryKeys = normalizedTaskIds.map((taskId) => agentSessionQueryKeys.list(repoPath, taskId));
  const readOwnership = (): string =>
    queryKeys
      .map((queryKey) =>
        sessionOwnershipKey(queryClient.getQueryData<AgentSessionRecord[]>(queryKey) ?? []),
      )
      .join("\n");
  const before = readOwnership();
  // A read that started before this change reads again, so it cannot complete the change.
  getAgentSessionListBatch(queryClient).markStale(repoPath, normalizedTaskIds);
  // Joining a read in progress keeps imperative callers of that read free of cancellation.
  await Promise.all(
    queryKeys.map((queryKey) =>
      queryClient.invalidateQueries(
        { queryKey, exact: true },
        { throwOnError: true, cancelRefetch: false },
      ),
    ),
  );
  return readOwnership() !== before;
};

const sessionOwnershipKey = (records: AgentSessionRecord[]): string =>
  JSON.stringify(
    records
      .map((record) => [
        record.externalSessionId,
        record.runtimeKind,
        record.workingDirectory,
        record.role,
      ])
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  );

export const cachedAgentSessionTaskIds = (queryClient: QueryClient, repoPath: string): string[] =>
  queryClient
    .getQueryCache()
    .findAll({ queryKey: agentSessionQueryKeys.all, exact: false })
    .flatMap((query) => {
      const [, kind, cachedRepoPath, taskId] = query.queryKey;
      const taskIdResult = queryKeyStringSchema.safeParse(taskId);
      return kind === "list" && cachedRepoPath === repoPath && taskIdResult.success
        ? [taskIdResult.data]
        : [];
    });

/**
 * Keeps the list cache current from one live observation of a repository. Only the first
 * connection snapshot comes from a normal attachment. A later one follows missed events, which
 * can include record updates, so the cached lists of the repository read again.
 */
export const createAgentSessionListLiveSync = (queryClient: QueryClient) => {
  let attached = false;
  return (envelope: AgentSessionLiveEnvelope): void => {
    if (envelope.type === "task_session_records_updated") {
      updateAgentSessionListQuery(queryClient, envelope.repoPath, envelope);
      return;
    }
    if (envelope.type !== "snapshot" || !envelope.isConnectionSnapshot) return;
    if (attached) {
      const taskIds = cachedAgentSessionTaskIds(queryClient, envelope.repoPath);
      // A failed read stays on its list query, where the session read model reports it.
      void refreshAgentSessionLists(queryClient, envelope.repoPath, taskIds).catch(() => false);
    }
    attached = true;
  };
};
