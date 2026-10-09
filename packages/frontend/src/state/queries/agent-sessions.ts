import type {
  AgentSessionLiveEnvelope,
  AgentSessionRecord,
  TaskAgentSessions,
} from "@openducktor/contracts";
import { isCancelledError, type QueryClient, queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { host } from "../operations/host";
import { getSessionReads, type SessionReadCommit } from "./agent-session-reads";

export type AgentSessionReadPort = Pick<typeof host, "agentSessionsListForTasks">;

export const normalizeAgentSessionTaskIds = (taskIds: string[]): string[] =>
  Array.from(new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean))).sort();

export const agentSessionQueryKeys = {
  all: ["agent-sessions"] as const,
  list: (repoPath: string, taskId: string) =>
    [...agentSessionQueryKeys.all, "list", repoPath, taskId] as const,
};

/** A committed host update replaces the full task list and supersedes older reads. */
export const updateAgentSessionListQuery = (
  queryClient: QueryClient,
  repoPath: string,
  records: TaskAgentSessions,
): void => {
  getSessionReads(queryClient).update(repoPath, records);
};

export const agentSessionListQueryOptions = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  readPort: AgentSessionReadPort = host,
  change = false,
) =>
  queryOptions({
    queryKey: agentSessionQueryKeys.list(repoPath, taskId),
    queryFn: ({ signal }): Promise<AgentSessionRecord[]> =>
      getSessionReads(queryClient).read(repoPath, taskId, readPort, signal, change),
    retry: false,
    retryOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
  });

export const loadAgentSessionListFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  options?: { forceFresh?: boolean; readPort?: AgentSessionReadPort },
): Promise<AgentSessionRecord[]> => {
  const state = queryClient.getQueryState(agentSessionQueryKeys.list(repoPath, taskId));
  if (!options?.forceFresh && state?.status === "error") return Promise.reject(state.error);
  getSessionReads(queryClient).skipWait(repoPath);
  const query = agentSessionListQueryOptions(queryClient, repoPath, taskId, options?.readPort);
  return fetchCurrentList(queryClient, options?.forceFresh ? { ...query, staleTime: 0 } : query);
};

export const loadAgentSessionListsFromQuery = async (
  queryClient: QueryClient,
  repoPath: string,
  taskIds: string[],
  options?: { forceFresh?: boolean; readPort?: AgentSessionReadPort },
): Promise<Record<string, AgentSessionRecord[]>> => {
  const ids = normalizeAgentSessionTaskIds(taskIds);
  const release = getSessionReads(queryClient).registerDemand(repoPath, ids);
  try {
    await Promise.all(
      ids.map((taskId) => loadAgentSessionListFromQuery(queryClient, repoPath, taskId, options)),
    );
    // A task that finished early can change while another task is still loading.
    const entries = await Promise.all(
      ids.map(
        async (taskId) =>
          [
            taskId,
            await loadAgentSessionListFromQuery(queryClient, repoPath, taskId, {
              readPort: options?.readPort ?? host,
            }),
          ] as const,
      ),
    );
    return Object.fromEntries(entries);
  } finally {
    release();
  }
};

export const retryAgentSessionListQueries = async (
  queryClient: QueryClient,
  repoPath: string,
  taskIds: string[],
  readPort: AgentSessionReadPort = host,
): Promise<void> => {
  const needed = normalizeAgentSessionTaskIds(taskIds).filter((taskId) => {
    const state = queryClient.getQueryState(agentSessionQueryKeys.list(repoPath, taskId));
    return state?.status === "error" || state?.isInvalidated || state?.data === undefined;
  });
  await loadAgentSessionListsFromQuery(queryClient, repoPath, needed, {
    forceFresh: true,
    readPort,
  });
};

export const removeAgentSessionListQueries = async (
  queryClient: QueryClient,
  repoPath: string,
  taskIds: string[],
): Promise<void> => {
  const ids = normalizeAgentSessionTaskIds(taskIds);
  const reads = getSessionReads(queryClient);
  reads.delete(repoPath, ids);
  await Promise.all(
    ids.map(async (taskId) => {
      if (!reads.isDeleted(repoPath, taskId)) return;
      const queryKey = agentSessionQueryKeys.list(repoPath, taskId);
      await queryClient.cancelQueries({ queryKey, exact: true });
      if (!reads.isDeleted(repoPath, taskId)) return;
      const query = queryClient.getQueryCache().find({ queryKey, exact: true });
      if (query && query.getObserversCount() > 0) queryClient.setQueryData(queryKey, []);
      else queryClient.removeQueries({ queryKey, exact: true });
    }),
  );
};

export const invalidateAgentSessionListQuery = async (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
): Promise<void> => {
  getSessionReads(queryClient).invalidate(repoPath, [taskId]);
  const queryKey = agentSessionQueryKeys.list(repoPath, taskId);
  await queryClient.cancelQueries({ queryKey, exact: true });
  await queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
};

export const refreshAgentSessionListQuery = async (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  readPort: AgentSessionReadPort = host,
): Promise<void> => {
  getSessionReads(queryClient).invalidate(repoPath, [taskId]);
  await queryClient.invalidateQueries({
    queryKey: agentSessionQueryKeys.list(repoPath, taskId),
    exact: true,
    refetchType: "none",
  });
  try {
    await loadAgentSessionListFromQuery(queryClient, repoPath, taskId, {
      forceFresh: true,
      readPort,
    });
  } catch (cause) {
    if (!isCancelledError(cause)) throw cause;
  }
};

export const refreshAgentSessionLists = async (
  queryClient: QueryClient,
  repoPath: string,
  taskIds: string[],
  readPort: AgentSessionReadPort = host,
): Promise<SessionReadCommit[]> => {
  const reads = getSessionReads(queryClient);
  const ids = normalizeAgentSessionTaskIds(taskIds);
  // Mark the change now so an older host response cannot supply these records.
  reads.invalidate(repoPath, ids, true);
  const needed = ids.filter((taskId) => reads.hasDemand(repoPath, taskId));
  const invalidated = Promise.all(
    ids.map((taskId) =>
      queryClient.invalidateQueries({
        queryKey: agentSessionQueryKeys.list(repoPath, taskId),
        exact: true,
        refetchType: "none",
      }),
    ),
  );
  const refreshed = Promise.all(
    needed.map((taskId) =>
      reads.refresh(repoPath, taskId, () =>
        fetchCurrentList(queryClient, {
          ...agentSessionListQueryOptions(queryClient, repoPath, taskId, readPort, true),
          staleTime: 0,
        }),
      ),
    ),
  );
  const [, commits] = await Promise.all([invalidated, refreshed]);
  return [...new Set(commits.flat())];
};

async function fetchCurrentList(
  queryClient: QueryClient,
  options: ReturnType<typeof agentSessionListQueryOptions>,
): Promise<AgentSessionRecord[]> {
  let records = await queryClient.fetchQuery(options);
  // A newer task change can cancel a result during Query's commit. Read the still-stale query again.
  while (queryClient.getQueryState(options.queryKey)?.isInvalidated)
    records = await queryClient.fetchQuery(options);
  return records;
}

const queryKeyStringSchema = z.string();

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
      getSessionReads(queryClient).invalidate(envelope.repoPath, taskIds, true);
      void queryClient
        .invalidateQueries({
          queryKey: [...agentSessionQueryKeys.all, "list", envelope.repoPath],
        })
        .catch(() => false);
    }
    attached = true;
  };
};
