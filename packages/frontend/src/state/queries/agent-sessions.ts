import type {
  AgentSessionLiveEnvelope,
  AgentSessionRecord,
  TaskAgentSessions,
} from "@openducktor/contracts";
import {
  CancelledError,
  isCancelledError,
  type QueryClient,
  queryOptions,
  replaceEqualDeep,
} from "@tanstack/react-query";
import { z } from "zod";
import { host } from "../operations/host";
import { getAgentSessionListBatch, shareAgentSessionList } from "./agent-session-list-batch";

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
  repoLists: (repoPath: string) => [...agentSessionQueryKeys.all, "list", repoPath] as const,
  list: (repoPath: string, taskId: string) =>
    [...agentSessionQueryKeys.repoLists(repoPath), taskId] as const,
};

/** A committed host update replaces the full task list and the read in progress for it. */
export const updateAgentSessionListQuery = (
  queryClient: QueryClient,
  repoPath: string,
  records: TaskAgentSessions,
): void => {
  // An older read cannot replace this update, also when its response has already returned.
  getAgentSessionListBatch(queryClient).markCommitted(repoPath, records.taskId);
  void cancelTaskListReads(queryClient, repoPath, [records.taskId]);
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
    // A failed list waits for a task change or an explicit retry. A view mount does not retry it.
    refetchOnMount: (query) => query.state.status !== "error",
    // Query stores a read result some microtasks after the host response. A committed update,
    // a deletion, or a stream snapshot during that time keeps the newer list.
    structuralSharing: (previous, next) =>
      Array.isArray(next) && (previous === undefined || Array.isArray(previous))
        ? shareAgentSessionList(previous, next)
        : replaceEqualDeep(previous, next),
    staleTime: AGENT_SESSION_LIST_STALE_TIME,
  });

/**
 * Read once. A committed update or a task deletion can cancel the read and replace its list.
 * A caller that joined the cancelled read receives the replacement list.
 */
const readOnce = async (
  queryClient: QueryClient,
  queryKey: ReturnType<typeof agentSessionQueryKeys.list>,
  read: () => Promise<AgentSessionRecord[]>,
): Promise<AgentSessionRecord[]> => {
  const updatesBefore = queryClient.getQueryState(queryKey)?.dataUpdateCount ?? 0;
  try {
    return await read();
  } catch (error) {
    const state = queryClient.getQueryState<AgentSessionRecord[]>(queryKey);
    if (
      isCancelledError(error) &&
      state?.status === "success" &&
      state.fetchStatus === "idle" &&
      !state.isInvalidated &&
      state.dataUpdateCount > updatesBefore
    ) {
      return state.data!;
    }
    throw error;
  }
};

/**
 * Read a list until it reflects the latest task revision. A task change that arrives during
 * a read requires another read, also after the read in progress completes. A confirmed
 * deletion completes the read with an empty list. A replacement stream snapshot cancels the
 * reads that started before it.
 */
const readCurrentList = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  read: (force: boolean) => Promise<AgentSessionRecord[]>,
): Promise<AgentSessionRecord[]> => {
  const batch = getAgentSessionListBatch(queryClient);
  const queryKey = agentSessionQueryKeys.list(repoPath, taskId);
  const epoch = batch.epoch();
  const workspaceEpoch = batch.workspaceEpoch(repoPath);
  const readCurrent = async (): Promise<AgentSessionRecord[]> => {
    for (let force = false; ; force = true) {
      let records: AgentSessionRecord[];
      try {
        records = await readOnce(queryClient, queryKey, () => read(force));
      } catch (error) {
        if (
          isCancelledError(error) &&
          batch.epoch() === epoch &&
          batch.isDeleted(repoPath, taskId)
        ) {
          return [];
        }
        throw error;
      }
      // A stream snapshot or the release of a closed workspace supersedes this read.
      if (batch.epoch() !== epoch || batch.workspaceEpoch(repoPath) !== workspaceEpoch) {
        throw new CancelledError({ revert: true });
      }
      if (batch.isDeleted(repoPath, taskId)) return [];
      if (batch.isCurrent(repoPath, taskId, batch.revision(repoPath, taskId))) {
        // A committed update stays stored over an older read result.
        return queryClient.getQueryData<AgentSessionRecord[]>(queryKey) ?? records;
      }
    }
  };
  const operation = readCurrent();
  // A task change that arrives before this read settles waits for it.
  batch.trackRead(repoPath, taskId, operation);
  return operation;
};

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
  return readCurrentList(queryClient, repoPath, taskId, (force) =>
    queryClient.fetchQuery(force || options?.forceFresh ? { ...query, staleTime: 0 } : query),
  );
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
  const cancelled = queryClient.cancelQueries({ queryKey: agentSessionQueryKeys.all });
  // Cancelled reads must not reach the host. A deleted task fails the whole batch request.
  getAgentSessionListBatch(queryClient).dropAll();
  return cancelled;
};

const cancelTaskListReads = (
  queryClient: QueryClient,
  repoPath: string,
  taskIds: string[],
): Promise<void> => {
  const cancelled = Promise.all(
    taskIds.map((taskId) =>
      queryClient.cancelQueries({
        queryKey: agentSessionQueryKeys.list(repoPath, taskId),
        exact: true,
      }),
    ),
  );
  getAgentSessionListBatch(queryClient).drop(repoPath, taskIds);
  return cancelled.then(() => undefined);
};

/** Remove confirmed deleted tasks. Later reads of these tasks return an empty list. */
export const removeAgentSessionListQueries = async (
  queryClient: QueryClient,
  repoPath: string,
  taskIds: string[],
): Promise<void> => {
  const normalizedTaskIds = normalizeAgentSessionTaskIds(taskIds);
  getAgentSessionListBatch(queryClient).markDeleted(repoPath, normalizedTaskIds);
  const cancelled = cancelTaskListReads(queryClient, repoPath, normalizedTaskIds);
  // Replace the lists before a caller of a cancelled read inspects them.
  for (const taskId of normalizedTaskIds) {
    const queryKey = agentSessionQueryKeys.list(repoPath, taskId);
    const query = queryClient.getQueryCache().find({ queryKey, exact: true });
    if (query && query.getObserversCount() > 0) {
      queryClient.setQueryData(queryKey, []);
    } else {
      queryClient.removeQueries({ queryKey, exact: true });
    }
  }
  await cancelled;
};

/** Drop the cached lists and the pending reads of a workspace that closed. */
export const releaseAgentSessionListQueries = async (
  queryClient: QueryClient,
  repoPath: string,
): Promise<void> => {
  const queryKey = agentSessionQueryKeys.repoLists(repoPath);
  const cancelled = queryClient.cancelQueries({ queryKey });
  getAgentSessionListBatch(queryClient).release(repoPath);
  queryClient.removeQueries({ queryKey });
  await cancelled;
};

/**
 * Read a changed list. Without a read port, read only a list that a view observes or that a
 * read in progress needs. That need lasts until a read reflects the change.
 */
const refreshChangedList = async (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  readPort?: AgentSessionReadPort,
): Promise<void> => {
  const queryKey = agentSessionQueryKeys.list(repoPath, taskId);
  // Public reads in progress read until they reflect this change. The change waits for them.
  const pendingReads = getAgentSessionListBatch(queryClient).pendingReads(repoPath, taskId);
  void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
  if (readPort) {
    const query = agentSessionListQueryOptions(repoPath, taskId, readPort);
    await Promise.all([
      readCurrentList(queryClient, repoPath, taskId, () =>
        queryClient.fetchQuery({ ...query, staleTime: 0 }),
      ),
      ...pendingReads,
    ]);
    return;
  }
  const query = queryClient.getQueryCache().find<AgentSessionRecord[]>({ queryKey, exact: true });
  await Promise.all([
    // Joining a read in progress keeps its other callers free of cancellation.
    query && (query.isActive() || query.state.fetchStatus === "fetching")
      ? readCurrentList(queryClient, repoPath, taskId, () =>
          query.fetch(undefined, { cancelRefetch: false }),
        )
      : undefined,
    ...pendingReads,
  ]);
};

/** Read current records for one task, also when no view observes its list. */
export const refreshAgentSessionListQuery = async (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  readPort: AgentSessionReadPort = host,
): Promise<void> => {
  getAgentSessionListBatch(queryClient).markChanged(repoPath, [taskId]);
  try {
    await refreshChangedList(queryClient, repoPath, taskId, readPort);
  } catch (error) {
    // A task deletion or a stream snapshot cancels the read and owns the list.
    if (!isCancelledError(error)) {
      throw error;
    }
  }
};

/**
 * Read again the changed lists that a view observes or that a read in progress needs. The other
 * changed lists stay stale until a view needs them. Returns the tasks whose session membership
 * or ownership changed.
 */
export const refreshAgentSessionLists = async (
  queryClient: QueryClient,
  repoPath: string,
  taskIds: string[],
): Promise<string[]> => {
  const batch = getAgentSessionListBatch(queryClient);
  const normalizedTaskIds = normalizeAgentSessionTaskIds(taskIds);
  const readOwnership = (taskId: string): string =>
    readAgentSessionOwnership(queryClient, repoPath, taskId);
  const before = new Map(normalizedTaskIds.map((taskId) => [taskId, readOwnership(taskId)]));
  // Mark the change at once, so a read that started before it cannot complete it.
  batch.markChanged(repoPath, normalizedTaskIds);
  await Promise.all(
    normalizedTaskIds.map((taskId) => refreshChangedList(queryClient, repoPath, taskId)),
  );
  // A deletion clears its task sessions directly and needs no live refresh.
  return normalizedTaskIds.filter(
    (taskId) => !batch.isDeleted(repoPath, taskId) && readOwnership(taskId) !== before.get(taskId),
  );
};

/** The session membership and ownership of a cached task list, as a comparable key. */
export const readAgentSessionOwnership = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
): string =>
  sessionOwnershipKey(
    queryClient.getQueryData<AgentSessionRecord[]>(agentSessionQueryKeys.list(repoPath, taskId)) ??
      [],
  );

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
      void refreshAgentSessionLists(queryClient, envelope.repoPath, taskIds).catch(() => []);
    }
    attached = true;
  };
};
