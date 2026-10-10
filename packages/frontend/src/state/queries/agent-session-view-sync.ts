import type { ExternalTaskSyncEvent } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import type { host } from "../operations/host";
import {
  agentSessionQueryKeys,
  type AgentSessionReadPort,
  cachedAgentSessionTaskIds,
  cancelAgentSessionListReads,
  loadAgentSessionListsFromQuery,
  removeAgentSessionListQueries,
  refreshAgentSessionLists,
} from "./agent-sessions";
import { repoTaskIdsQueryOptions } from "./tasks";

export type AgentSessionViewReadPort = AgentSessionReadPort & Pick<typeof host, "taskIdsList">;

export type AgentSessionViewSync = {
  /** Reconcile consecutive task events together, so their session reads share requests. */
  reconcileExternalEvents: (events: ExternalTaskSyncEvent[]) => Promise<void>;
  reconcileStreamSnapshot: (activeRepoPath: string | null, taskIds: string[]) => Promise<void>;
};

export const createAgentSessionViewSync = ({
  queryClient,
  readPort,
  removeTaskSessions,
  refreshLiveSessions,
}: {
  queryClient: QueryClient;
  readPort: AgentSessionViewReadPort;
  removeTaskSessions: (repoPath: string, taskIds: string[]) => void;
  refreshLiveSessions: (repoPath: string) => Promise<void>;
}): AgentSessionViewSync => ({
  reconcileExternalEvents: async (events) => {
    await Promise.all(
      [...collectTaskChanges(events)].map(async ([repoPath, changes]) => {
        const removedTaskIds = [...changes].flatMap(([taskId, change]) =>
          change === "remove" ? [taskId] : [],
        );
        const refreshedTaskIds = [...changes].flatMap(([taskId, change]) =>
          change === "refresh" ? [taskId] : [],
        );
        await removeAgentSessionListQueries(queryClient, repoPath, removedTaskIds);
        removeTaskSessions(repoPath, removedTaskIds);
        if (await refreshAgentSessionLists(queryClient, repoPath, refreshedTaskIds)) {
          await refreshLiveSessions(repoPath);
        }
      }),
    );
  },
  reconcileStreamSnapshot: async (activeRepoPath, taskIds) => {
    const taskIdSet = new Set(taskIds);
    // The Kanban list hides older done tasks, so a task that it omits can still exist.
    const unlistedTaskIds = activeRepoPath
      ? cachedAgentSessionTaskIds(queryClient, activeRepoPath).filter(
          (taskId) => !taskIdSet.has(taskId),
        )
      : [];
    await cancelAgentSessionListReads(queryClient);
    // A view can observe the lists of an inactive workspace, such as the session sidebar in
    // all-workspaces scope. Those lists refetch; every other list reloads when it is next read.
    const observedInactiveLists = queryClient
      .getQueryCache()
      .findAll({ queryKey: agentSessionQueryKeys.all, exact: false, type: "active" })
      .filter((query) => query.queryKey[1] === "list" && query.queryKey[2] !== activeRepoPath);
    const observedInactiveListSet = new Set(observedInactiveLists);
    queryClient.removeQueries({
      queryKey: agentSessionQueryKeys.all,
      exact: false,
      predicate: (query) => !observedInactiveListSet.has(query),
    });
    const inactiveRefetches = Promise.all(
      observedInactiveLists.map((query) =>
        queryClient.refetchQueries({ queryKey: query.queryKey, exact: true }),
      ),
    );
    if (!activeRepoPath) {
      await inactiveRefetches;
      return;
    }
    const [existingTaskIds] = await Promise.all([
      unlistedTaskIds.length > 0
        ? queryClient.fetchQuery({
            ...repoTaskIdsQueryOptions(activeRepoPath, readPort),
            staleTime: 0,
          })
        : [],
      inactiveRefetches,
      loadAgentSessionListsFromQuery(queryClient, activeRepoPath, taskIds, {
        forceFresh: true,
        readPort,
      }),
    ]);
    const existingTaskIdSet = new Set(existingTaskIds);
    removeTaskSessions(
      activeRepoPath,
      unlistedTaskIds.filter((taskId) => !existingTaskIdSet.has(taskId)),
    );
    await refreshLiveSessions(activeRepoPath);
  },
});

type TaskSessionChange = "refresh" | "remove";

/** The last event that names a task decides whether its sessions refresh or go away. */
const collectTaskChanges = (
  events: ExternalTaskSyncEvent[],
): Map<string, Map<string, TaskSessionChange>> => {
  const changesByRepo = new Map<string, Map<string, TaskSessionChange>>();
  for (const event of events) {
    const changes = changesByRepo.get(event.repoPath) ?? new Map<string, TaskSessionChange>();
    changesByRepo.set(event.repoPath, changes);
    if (event.kind === "external_task_created") {
      changes.set(event.taskId, "refresh");
      continue;
    }
    for (const taskId of event.taskIds) changes.set(taskId, "refresh");
    for (const taskId of event.removedTaskIds) changes.set(taskId, "remove");
  }
  return changesByRepo;
};
