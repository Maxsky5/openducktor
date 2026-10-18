import type { ExternalTaskSyncEvent } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import type { HostClient } from "@openducktor/host-client";
import { getAgentSessionListBatch } from "./agent-session-list-batch";
import {
  agentSessionQueryKeys,
  type AgentSessionReadPort,
  cachedAgentSessionTaskIds,
  cancelAgentSessionListReads,
  loadAgentSessionListsFromQuery,
  readAgentSessionOwnership,
  releaseAgentSessionListQueries,
  removeAgentSessionListQueries,
  refreshAgentSessionLists,
} from "./agent-sessions";
import { repoTaskIdsQueryOptions } from "./tasks";

export type AgentSessionViewReadPort = AgentSessionReadPort & Pick<HostClient, "taskIdsList">;

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
  /**
   * Reconcile the session lists of each open workspace with the task IDs that its snapshot read.
   * Returns the cause for each workspace whose own reads failed. A failed read of the observed
   * lists fails the whole snapshot.
   */
  reconcileStreamSnapshot: (
    taskIdsByRepo: ReadonlyMap<string, string[]>,
    isCurrentOwner: () => boolean,
  ) => Promise<ReadonlyMap<string, unknown>>;
  /** Drop the cached lists and the live refresh state of a workspace that closed. */
  releaseWorkspace: (repoPath: string) => Promise<void>;
};

export const createAgentSessionViewSync = ({
  queryClient,
  readPort,
  listSessionTaskIds,
  removeTaskSessions,
  refreshLiveSessions,
  isWorkspaceOpen,
  isWorkspaceActive,
}: {
  queryClient: QueryClient;
  readPort: AgentSessionViewReadPort;
  /** The tasks that own workflow session state, also after their list query expires. */
  listSessionTaskIds: (repoPath: string) => string[];
  removeTaskSessions: (repoPath: string, taskIds: string[]) => void;
  refreshLiveSessions: (repoPath: string) => Promise<void>;
  /** Only an open workspace starts session reads or a live refresh. */
  isWorkspaceOpen: (repoPath: string) => boolean;
  /** The agent orchestrator reads the lists of the active workspace from the cache. */
  isWorkspaceActive: (repoPath: string) => boolean;
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
      const workspaceEpoch = batch.workspaceEpoch(event.repoPath);
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
      try {
        const [, changedTaskIds] = await Promise.all([removal, refresh]);
        return { repoPath: event.repoPath, changedTaskIds };
      } catch (error) {
        // The release of a workspace that closed cancelled these reads. Their result does not matter.
        if (batch.workspaceEpoch(event.repoPath) !== workspaceEpoch) {
          return { repoPath: event.repoPath, changedTaskIds: [] };
        }
        throw error;
      }
    },
    completeExternalEvents: async (changes, isCurrentOwner) => {
      const results = await Promise.all(changes);
      // A stopped stream or a replacement snapshot supersedes the work of the older owner.
      if (!isCurrentOwner()) return;
      const changedTaskIdsByRepo = new Map<string, Set<string>>();
      for (const { repoPath, changedTaskIds } of results) {
        if (changedTaskIds.length === 0 || !isWorkspaceOpen(repoPath)) continue;
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
    reconcileStreamSnapshot: async (taskIdsByRepo, isCurrentOwner) => {
      const failures = new Map<string, unknown>();
      /**
       * Run the work of each open workspace. Keep the workspaces whose work succeeded, and record
       * the cause of each other workspace. A release during the work supersedes its result.
       */
      const runForOpenRepos = async <Repo extends { repoPath: string }, Result>(
        repos: Repo[],
        work: (repo: Repo) => Promise<Result>,
      ): Promise<Result[]> => {
        const started = repos
          .filter(({ repoPath }) => isWorkspaceOpen(repoPath))
          .map((repo) => ({ repo, workspaceEpoch: batch.workspaceEpoch(repo.repoPath) }));
        const results = await Promise.allSettled(started.map(({ repo }) => work(repo)));
        return results.flatMap((result, index) => {
          const { repo, workspaceEpoch } = started[index]!;
          if (batch.workspaceEpoch(repo.repoPath) !== workspaceEpoch) return [];
          if (result.status === "fulfilled") return [result.value];
          failures.set(repo.repoPath, result.reason);
          return [];
        });
      };
      const snapshotRepos = [...taskIdsByRepo].map(([repoPath, taskIds]) => {
        const taskIdSet = new Set(taskIds);
        // The Kanban list hides older done tasks, so a task that it omits can still exist.
        const unlistedTaskIds = [
          ...new Set([
            ...cachedAgentSessionTaskIds(queryClient, repoPath),
            ...listSessionTaskIds(repoPath),
          ]),
        ].filter((taskId) => !taskIdSet.has(taskId));
        return { repoPath, taskIds, unlistedTaskIds };
      });
      await cancelAgentSessionListReads(queryClient);
      const epoch = batch.epoch();
      // Confirm deletions before the lists read again, so a view cannot read a deleted task.
      const confirmed = await runForOpenRepos(snapshotRepos, async (repo) => ({
        ...repo,
        existingTaskIds: new Set(
          repo.unlistedTaskIds.length > 0
            ? await queryClient.fetchQuery({
                ...repoTaskIdsQueryOptions(repo.repoPath, readPort),
                staleTime: 0,
              })
            : [],
        ),
      }));
      // A newer snapshot or a stopped stream owns the lists. The stream ignores this result.
      if (batch.epoch() !== epoch || !isCurrentOwner()) return failures;
      const removals = confirmed.map(({ repoPath, taskIds, unlistedTaskIds, existingTaskIds }) => {
        const deletedTaskIds = unlistedTaskIds.filter((taskId) => !existingTaskIds.has(taskId));
        batch.markExisting(repoPath, [...taskIds, ...existingTaskIds]);
        // A mounted view of a deleted task keeps its query and receives the empty list.
        const removal = removeAgentSessionListQueries(queryClient, repoPath, deletedTaskIds);
        removeTaskSessions(repoPath, deletedTaskIds);
        return removal;
      });
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
      const [, , loaded] = await Promise.all([
        Promise.all(removals),
        queryClient.refetchQueries(
          { queryKey: agentSessionQueryKeys.all, type: "active" },
          { throwOnError: true, cancelRefetch: false },
        ),
        runForOpenRepos(confirmed, async (repo) => {
          // Views read the lists that they observe. The active workspace reads all of its lists.
          if (isWorkspaceActive(repo.repoPath)) {
            await loadAgentSessionListsFromQuery(queryClient, repo.repoPath, repo.taskIds, {
              forceFresh: true,
              readPort,
            });
          }
          return repo;
        }),
      ]);
      if (batch.epoch() === epoch && isCurrentOwner()) {
        await runForOpenRepos(loaded, ({ repoPath }) => startLiveRefresh(repoPath));
      }
      return failures;
    },
    releaseWorkspace: (repoPath) => {
      liveRefreshes.delete(repoPath);
      return releaseAgentSessionListQueries(queryClient, repoPath);
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
