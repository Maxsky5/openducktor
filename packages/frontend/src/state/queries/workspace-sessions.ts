import { WORKSPACE_SESSION_ARCHIVE_LIMIT, type WorkspaceSession } from "@openducktor/contracts";
import { type QueryClient, queryOptions, replaceEqualDeep } from "@tanstack/react-query";
import { workspaceComparisonChoices } from "../workspace-comparison-choices";
import { host } from "../operations/host";

const pendingReads = new WeakMap<QueryClient, Map<string, Set<Map<string, WorkspaceSession>>>>();
// Pending commits are removed on cache commit or query cancellation.
const snapshotCommits = new Map<unknown, () => WorkspaceSession[]>();

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
  list: (workspaceId: string, archived: boolean) =>
    ["workspace-sessions", workspaceId, archived ? "archived" : "active"] as const,
};

export const workspaceSessionListQueryOptions = (
  workspaceId: string,
  archived = false,
  readPort: Pick<typeof host, "workspaceSessionListActive" | "workspaceSessionListArchived"> = host,
) =>
  queryOptions<WorkspaceSession[]>({
    queryKey: workspaceSessionQueryKeys.list(workspaceId, archived),
    queryFn: async ({ client, signal }) => {
      let byKey = pendingReads.get(client);
      if (!byKey) {
        byKey = new Map();
        pendingReads.set(client, byKey);
      }
      const key = JSON.stringify(workspaceSessionQueryKeys.list(workspaceId, archived));
      let reads = byKey.get(key);
      if (!reads) {
        reads = new Set();
        byKey.set(key, reads);
      }
      const updates = new Map<string, WorkspaceSession>();
      reads.add(updates);
      let snapshot: WorkspaceSession[] | undefined;
      const finish = (): void => {
        if (!reads.delete(updates)) return;
        if (reads.size === 0) byKey.delete(key);
        if (snapshot) snapshotCommits.delete(snapshot);
        signal.removeEventListener("abort", finish);
      };
      signal.addEventListener("abort", finish, { once: true });
      try {
        const records = await (archived
          ? readPort.workspaceSessionListArchived(workspaceId)
          : readPort.workspaceSessionListActive(workspaceId));
        snapshot = [...records];
        if (signal.aborted) return snapshot;
        // Keep events through the query result's Promise handoff, until the cache commits it.
        snapshotCommits.set(snapshot, () => {
          let merged = records;
          for (const session of updates.values()) merged = applyRecord(merged, session, archived);
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

/** Apply ordered metadata and retain it for any older snapshot still in flight. */
export const updateWorkspaceSessionQueries = (
  queryClient: QueryClient,
  workspaceId: string,
  session: WorkspaceSession,
): void => {
  if (session.archivedAt !== null)
    workspaceComparisonChoices(queryClient).clear({ workspaceId, sessionId: session.id });
  for (const archived of [false, true]) {
    const queryKey = workspaceSessionQueryKeys.list(workspaceId, archived);
    const reads = pendingReads.get(queryClient)?.get(JSON.stringify(queryKey));
    for (const updates of reads ?? []) updates.set(session.id, session);
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
    queryFn: () => host.customAgentRoleList(),
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
