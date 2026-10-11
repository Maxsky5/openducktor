import type { ExternalTaskSyncEvent } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import type { host } from "../operations/host";
import { getAgentSessionListBatch } from "./agent-session-list-batch";
import {
  agentSessionQueryKeys,
  type AgentSessionReadPort,
  cachedAgentSessionTaskIds,
  cancelAgentSessionListReads,
  loadAgentSessionListsFromQuery,
  readAgentSessionOwnership,
  removeAgentSessionListQueries,
  refreshAgentSessionLists,
} from "./agent-sessions";
import { repoTaskIdsQueryOptions } from "./tasks";

export type AgentSessionViewReadPort = AgentSessionReadPort & Pick<typeof host, "taskIdsList">;

/** The session-list result of one admitted task event. */
export type AdmittedSessionChange = Promise<{ repoPath: string; changedTaskIds: string[] }>;

/** A live refresh and the session ownership of the cached lists when it started. */
type LiveRefresh = { done: Promise<void>; ownership: Map<string, string> };

export type AgentSessionViewSync = {
  /** Start the session-list work of a received event, so its reads join pending requests. */
  admitExternalEvent: (event: ExternalTaskSyncEvent) => AdmittedSessionChange;
  /**
   * Wait for admitted events, then refresh live sessions once for each changed workspace.
   * The stream owner that admitted the events must still own them.
   */
  completeExternalEvents: (
    changes: AdmittedSessionChange[],
    isCurrentOwner: () => boolean,
  ) => Promise<void>;
  /** Supersede the session work of a replaced stream when a replacement snapshot arrives. */
  cancelReads: () => void;
  reconcileStreamSnapshot: (
    activeRepoPath: string | null,
    taskIds: string[],
    isCurrentOwner: () => boolean,
  ) => Promise<void>;
};

export const createAgentSessionViewSync = ({
  queryClient,
  readPort,
  listSessionTaskIds,
  removeTaskSessions,
  refreshLiveSessions,
}: {
  queryClient: QueryClient;
  readPort: AgentSessionViewReadPort;
  /** The tasks that own workflow session state, also after their list query expires. */
  listSessionTaskIds: (repoPath: string) => string[];
  removeTaskSessions: (repoPath: string, taskIds: string[]) => void;
  refreshLiveSessions: (repoPath: string) => Promise<void>;
}): AgentSessionViewSync => {
  const batch = getAgentSessionListBatch(queryClient);
  const liveRefreshes = new Map<string, LiveRefresh>();

  const startLiveRefresh = (repoPath: string): Promise<void> => {
    const ownership = new Map(
      cachedAgentSessionTaskIds(queryClient, repoPath).map((taskId) => [
        taskId,
        readAgentSessionOwnership(queryClient, repoPath, taskId),
      ]),
    );
    const refresh: LiveRefresh = { done: refreshLiveSessions(repoPath), ownership };
    liveRefreshes.set(repoPath, refresh);
    // A failed refresh does not cover later changes.
    refresh.done.catch(() => {
      if (liveRefreshes.get(repoPath) === refresh) liveRefreshes.delete(repoPath);
    });
    return refresh.done;
  };

  /** Share the last live refresh when its start already saw the ownership of these tasks. */
  const refreshLiveFor = (repoPath: string, taskIds: string[]): Promise<void> => {
    const last = liveRefreshes.get(repoPath);
    const covered = taskIds.every(
      (taskId) =>
        last?.ownership.get(taskId) === readAgentSessionOwnership(queryClient, repoPath, taskId),
    );
    return last && covered ? last.done : startLiveRefresh(repoPath);
  };

  return {
    admitExternalEvent: async (event) => {
      const { refreshedTaskIds, removedTaskIds } = toTaskChanges(event);
      // An event that keeps a task proves that the task exists.
      batch.markExisting(event.repoPath, refreshedTaskIds);
      // A list that failed in one request with a deleted task reads again. The deletion can
      // explain the failure of the whole request.
      const failedWithDeletion = batch
        .takeFailedWith(event.repoPath, removedTaskIds)
        .filter(
          (taskId) =>
            queryClient.getQueryState(agentSessionQueryKeys.list(event.repoPath, taskId))
              ?.status === "error",
        );
      // Both start before the first await, so reads in progress learn about the change at once.
      const removal = removeAgentSessionListQueries(queryClient, event.repoPath, removedTaskIds);
      removeTaskSessions(event.repoPath, removedTaskIds);
      const refresh = refreshAgentSessionLists(queryClient, event.repoPath, [
        ...refreshedTaskIds,
        ...failedWithDeletion,
      ]);
      const [, changedTaskIds] = await Promise.all([removal, refresh]);
      return { repoPath: event.repoPath, changedTaskIds };
    },
    completeExternalEvents: async (changes, isCurrentOwner) => {
      const results = await Promise.all(changes);
      // A stopped stream or a replacement snapshot supersedes the work of the older owner.
      if (!isCurrentOwner()) return;
      const changedTaskIdsByRepo = new Map<string, Set<string>>();
      for (const { repoPath, changedTaskIds } of results) {
        if (changedTaskIds.length === 0) continue;
        const repoTaskIds = changedTaskIdsByRepo.get(repoPath) ?? new Set<string>();
        for (const taskId of changedTaskIds) repoTaskIds.add(taskId);
        changedTaskIdsByRepo.set(repoPath, repoTaskIds);
      }
      await Promise.all(
        [...changedTaskIdsByRepo].map(([repoPath, taskIds]) =>
          refreshLiveFor(repoPath, [...taskIds]),
        ),
      );
    },
    cancelReads: () => {
      void cancelAgentSessionListReads(queryClient);
    },
    reconcileStreamSnapshot: async (activeRepoPath, taskIds, isCurrentOwner) => {
      const taskIdSet = new Set(taskIds);
      // The Kanban list hides older done tasks, so a task that it omits can still exist.
      const unlistedTaskIds = activeRepoPath
        ? [
            ...new Set([
              ...cachedAgentSessionTaskIds(queryClient, activeRepoPath),
              ...listSessionTaskIds(activeRepoPath),
            ]),
          ].filter((taskId) => !taskIdSet.has(taskId))
        : [];
      await cancelAgentSessionListReads(queryClient);
      const epoch = batch.epoch();
      // Confirm deletions before the lists read again, so a view cannot read a deleted task.
      const existingTaskIds = new Set(
        activeRepoPath && unlistedTaskIds.length > 0
          ? await queryClient.fetchQuery({
              ...repoTaskIdsQueryOptions(activeRepoPath, readPort),
              staleTime: 0,
            })
          : [],
      );
      // A newer snapshot or a stopped stream owns the lists. The stream ignores this result.
      if (batch.epoch() !== epoch || !isCurrentOwner()) return;
      const deletedTaskIds = unlistedTaskIds.filter((taskId) => !existingTaskIds.has(taskId));
      let removal: Promise<void> | undefined;
      if (activeRepoPath) {
        batch.markExisting(activeRepoPath, [...taskIds, ...existingTaskIds]);
        // A mounted view of a deleted task keeps its query and receives the empty list.
        removal = removeAgentSessionListQueries(queryClient, activeRepoPath, deletedTaskIds);
        removeTaskSessions(activeRepoPath, deletedTaskIds);
      }
      // Mounted views keep their queries, which read again in place. Every other list reloads
      // when it is next read.
      void queryClient.invalidateQueries({
        queryKey: agentSessionQueryKeys.all,
        refetchType: "none",
      });
      queryClient.removeQueries({
        queryKey: agentSessionQueryKeys.all,
        predicate: (query) => query.getObserversCount() === 0,
      });
      await Promise.all([
        removal,
        queryClient.refetchQueries(
          { queryKey: agentSessionQueryKeys.all, type: "active" },
          { throwOnError: true, cancelRefetch: false },
        ),
        activeRepoPath
          ? loadAgentSessionListsFromQuery(queryClient, activeRepoPath, taskIds, {
              forceFresh: true,
              readPort,
            })
          : undefined,
      ]);
      if (activeRepoPath && batch.epoch() === epoch && isCurrentOwner()) {
        await startLiveRefresh(activeRepoPath);
      }
    },
  };
};

/** Within one event, a removal wins over a change to the same task. */
const toTaskChanges = (event: ExternalTaskSyncEvent) => {
  if (event.kind === "external_task_created") {
    return { refreshedTaskIds: [event.taskId], removedTaskIds: [] };
  }
  const removed = new Set(event.removedTaskIds);
  return {
    refreshedTaskIds: event.taskIds.filter((taskId) => !removed.has(taskId)),
    removedTaskIds: event.removedTaskIds,
  };
};
