import type { WorkspaceSession } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import type {
  WorkspaceActivityArchivedSessions,
  WorkspaceActivityArchivedSessionsPort,
} from "@/features/workspace-activity/workspace-activity-observer";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { errorMessage } from "@/lib/errors";
import { workspaceSessionIdentity } from "@/state/operations/agent-orchestrator/session-read-model/workspace-session-records";
import {
  workspaceSessionListQueryOptions,
  workspaceSessionQueryKeys,
} from "@/state/queries/workspace-sessions";

const archivedSessionKeysByRecords = new WeakMap<
  readonly WorkspaceSession[],
  ReadonlySet<string>
>();

const toArchivedSessionKeys = (records: readonly WorkspaceSession[]): ReadonlySet<string> => {
  const cached = archivedSessionKeysByRecords.get(records);
  if (cached) {
    return cached;
  }
  const keys = new Set<string>();
  for (const record of records) {
    const identity = workspaceSessionIdentity(record);
    if (identity) {
      keys.add(agentSessionIdentityKey(identity));
    }
  }
  archivedSessionKeysByRecords.set(records, keys);
  return keys;
};

/**
 * Read the archived chat state of a workspace from the shared record cache.
 *
 * The state is read on demand instead of being kept by the caller, so a read
 * that fails and later succeeds needs no user action to clear.
 */
export const createWorkspaceArchivedSessionsPort = (
  queryClient: QueryClient,
): WorkspaceActivityArchivedSessionsPort => ({
  load: async (workspaceId) => {
    await queryClient.fetchQuery({
      ...workspaceSessionListQueryOptions(workspaceId, true),
      staleTime: Number.POSITIVE_INFINITY,
    });
  },
  read: (workspaceId): WorkspaceActivityArchivedSessions => {
    const state = queryClient.getQueryState<WorkspaceSession[]>(
      workspaceSessionQueryKeys.list(workspaceId, true),
    );
    // A failed read keeps the data of the last success, so the failure is
    // reported first instead of answering from data the source disowned.
    if (state?.status === "error") {
      return { status: "error", reason: errorMessage(state.error) };
    }
    if (state?.data) {
      return { status: "ready", keys: toArchivedSessionKeys(state.data) };
    }
    return { status: "unknown" };
  },
  subscribe: (onChange) =>
    queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated") {
        return;
      }
      if (event.action.type !== "success" && event.action.type !== "error") {
        return;
      }
      if (event.query.queryKey[0] === workspaceSessionQueryKeys.all[0]) {
        onChange();
      }
    }),
});
