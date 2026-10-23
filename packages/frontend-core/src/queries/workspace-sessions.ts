import { WORKSPACE_SESSION_ARCHIVE_LIMIT, type WorkspaceSession } from "@openducktor/contracts";
import { type QueryClient, queryOptions, replaceEqualDeep } from "@tanstack/react-query";
import { connectionHost } from "../connection/client-connection";

const pendingReads = new WeakMap<QueryClient, Map<string, Set<Map<string, WorkspaceSession>>>>();
// Pending commits are removed on cache commit or query cancellation.
const snapshotCommits = new Map<unknown, () => Array<WorkspaceSession | string>>();

const applyRecord = (
  records: WorkspaceSession[],
  session: WorkspaceSession,
  archived: boolean,
): WorkspaceSession[] => {
  const next = records.filter((entry) => entry.id !== session.id);
  if ((session.archivedAt !== null) === archived) next.push(session);
  next.sort((left, right) =>
    archived ? (right.archivedAt ?? 0) - (left.archivedAt ?? 0) : right.updatedAt - left.updatedAt,
  );
  return archived ? next.slice(0, WORKSPACE_SESSION_ARCHIVE_LIMIT) : next;
};

export const workspaceSessionQueryKeys = {
  all: ["workspace-sessions"] as const,
  ids: (workspaceId: string) => ["workspace-sessions", workspaceId, "ids"] as const,
  list: (workspaceId: string, archived: boolean) =>
    ["workspace-sessions", workspaceId, archived ? "archived" : "active"] as const,
};

const sessionQueryOptions = <T extends WorkspaceSession | string>(
  queryKey: readonly string[],
  read: (client: QueryClient) => Promise<T[]>,
  applyUpdate: (records: T[], session: WorkspaceSession) => T[],
) =>
  queryOptions<T[]>({
    queryKey,
    queryFn: async ({ client, signal }) => {
      let byKey = pendingReads.get(client);
      if (!byKey) {
        byKey = new Map();
        pendingReads.set(client, byKey);
      }
      const key = JSON.stringify(queryKey);
      let reads = byKey.get(key);
      if (!reads) {
        reads = new Set();
        byKey.set(key, reads);
      }
      const updates = new Map<string, WorkspaceSession>();
      reads.add(updates);
      let snapshot: T[] | undefined;
      const finish = (): void => {
        if (!reads.delete(updates)) return;
        if (reads.size === 0) byKey.delete(key);
        if (snapshot) snapshotCommits.delete(snapshot);
        signal.removeEventListener("abort", finish);
      };
      signal.addEventListener("abort", finish, { once: true });
      try {
        const records = await read(client);
        snapshot = [...records];
        if (signal.aborted) return snapshot;
        // Keep events through the query result's Promise handoff, until the cache commits it.
        snapshotCommits.set(snapshot, () => {
          let merged = records;
          for (const session of updates.values()) merged = applyUpdate(merged, session);
          finish();
          return merged;
        });
        return snapshot;
      } catch (cause) {
        finish();
        throw cause;
      }
    },
    structuralSharing: (previous, incoming) => {
      const commit = snapshotCommits.get(incoming);
      return replaceEqualDeep(previous, commit ? commit() : incoming);
    },
    gcTime: Number.POSITIVE_INFINITY,
    staleTime: 0,
    retry: false,
  });

export const workspaceSessionListQueryOptions = (workspaceId: string, archived = false) =>
  sessionQueryOptions(
    workspaceSessionQueryKeys.list(workspaceId, archived),
    (client) =>
      archived
        ? connectionHost(client).workspaceSessionListArchived(workspaceId)
        : connectionHost(client).workspaceSessionListActive(workspaceId),
    (records, session) => applyRecord(records, session, archived),
  );

const includeSessionId = (ids: string[], session: WorkspaceSession): string[] =>
  ids.includes(session.id) ? ids : [...ids, session.id];

export const workspaceSessionIdsQueryOptions = (workspaceId: string) =>
  sessionQueryOptions(
    workspaceSessionQueryKeys.ids(workspaceId),
    (client) => connectionHost(client).workspaceSessionIdsList(workspaceId),
    includeSessionId,
  );

/** Apply ordered metadata and retain it for any older snapshot still in flight. */
export const updateWorkspaceSessionQueries = (
  queryClient: QueryClient,
  workspaceId: string,
  session: WorkspaceSession,
): void => {
  const previous = [false, true]
    .flatMap(
      (archived) =>
        queryClient.getQueryData<WorkspaceSession[]>(
          workspaceSessionQueryKeys.list(workspaceId, archived),
        ) ?? [],
    )
    .find((record) => record.id === session.id);
  const ownershipChanged =
    previous === undefined ||
    (previous.archivedAt === null) !== (session.archivedAt === null) ||
    replaceEqualDeep(previous.executionTarget, session.executionTarget) !==
      previous.executionTarget;
  const titleChanged =
    previous !== undefined &&
    (previous.manualTitle?.trim() || previous.generatedTitle) !==
      (session.manualTitle?.trim() || session.generatedTitle);
  if (ownershipChanged || titleChanged) {
    void queryClient.invalidateQueries({ queryKey: ["workspace-session-archive-preview"] });
  }
  const idsKey = workspaceSessionQueryKeys.ids(workspaceId);
  for (const queryKey of [
    idsKey,
    workspaceSessionQueryKeys.list(workspaceId, false),
    workspaceSessionQueryKeys.list(workspaceId, true),
  ]) {
    const reads = pendingReads.get(queryClient)?.get(JSON.stringify(queryKey));
    for (const updates of reads ?? []) updates.set(session.id, session);
  }
  // One record cannot establish completeness after a failed ID read.
  if (queryClient.getQueryState(idsKey)?.status === "success") {
    queryClient.setQueryData<string[]>(idsKey, (ids) =>
      ids ? includeSessionId(ids, session) : undefined,
    );
  }
  for (const archived of [false, true]) {
    const queryKey = workspaceSessionQueryKeys.list(workspaceId, archived);
    if (queryClient.getQueryData(queryKey) === undefined) {
      continue;
    }
    queryClient.setQueryData<WorkspaceSession[]>(queryKey, (current) => {
      if (!current) return undefined;
      return applyRecord(current, session, archived);
    });
  }
};

export const customAgentRolesQueryOptions = () =>
  queryOptions({
    queryKey: ["custom-agent-roles"] as const,
    queryFn: ({ client }) => connectionHost(client).customAgentRoleList(),
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
