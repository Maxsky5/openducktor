import { workspaceScopeKey, workspaceScopeValue } from "./workspace-scope";
import { type WorkspaceRef } from "@openducktor/contracts";
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
export type AdmittedSessionChange = Promise<{ repoPath: WorkspaceRef; changedTaskIds: string[] }>;

/** A live refresh and the session ownership of the cached lists when it was queued. */
type LiveRefresh = { done: Promise<void>; ownership: Map<string, string> };

/** Replacement stream owners share the refresh lane of their host connection. */
const liveRefreshTails = new WeakMap<QueryClient, Promise<void>>();

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
    taskIdsByRepo: ReadonlyMap<WorkspaceRef, string[]>,
    isCurrentOwner: () => boolean,
  ) => Promise<ReadonlyMap<WorkspaceRef, unknown>>;
  /** Drop the cached lists and the live refresh state of a workspace that closed. */
  releaseWorkspace: (repoPath: WorkspaceRef) => Promise<void>;
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
  listSessionTaskIds: (repoPath: WorkspaceRef) => string[];
  removeTaskSessions: (repoPath: WorkspaceRef, taskIds: string[]) => void;
  refreshLiveSessions: (repoPath: WorkspaceRef) => Promise<void>;
  /** Only an open workspace starts session reads or a live refresh. */
  isWorkspaceOpen: (repoPath: WorkspaceRef) => boolean;
  /** The agent orchestrator reads the lists of the active workspace from the cache. */
  isWorkspaceActive: (repoPath: WorkspaceRef) => boolean;
}): AgentSessionViewSync => {
  const batch = getAgentSessionListBatch(queryClient);
  const liveRefreshes = new Map<string, LiveRefresh>();

  const startLiveRefresh = (
    repoPath: WorkspaceRef,
    isCurrentOwner: () => boolean,
  ): Promise<void> => {
    const epoch = batch.epoch();
    const workspaceEpoch = batch.workspaceEpoch(repoPath);
    const ownership = new Map(
      cachedAgentSessionTaskIds(queryClient, repoPath).map((taskId) => [
        taskId,
        readAgentSessionOwnership(queryClient, repoPath, taskId),
      ]),
    );
    // The host serializes refreshes. Wait here instead of occupying HTTP connections in its queue.
    const done = (liveRefreshTails.get(queryClient) ?? Promise.resolve()).then(async () => {
      if (
        batch.epoch() !== epoch ||
        batch.workspaceEpoch(repoPath) !== workspaceEpoch ||
        !isWorkspaceOpen(repoPath) ||
        !isCurrentOwner()
      ) {
        if (liveRefreshes.get(workspaceScopeKey(repoPath)) === refresh)
          liveRefreshes.delete(workspaceScopeKey(repoPath));
        return;
      }
      await refreshLiveSessions(repoPath);
    });
    const refresh: LiveRefresh = { done, ownership };
    liveRefreshes.set(workspaceScopeKey(repoPath), refresh);
    liveRefreshTails.set(
      queryClient,
      done.catch(() => {
        // A failed refresh does not cover later changes or stop the queue.
        if (liveRefreshes.get(workspaceScopeKey(repoPath)) === refresh)
          liveRefreshes.delete(workspaceScopeKey(repoPath));
      }),
    );
    return refresh.done;
  };

  /** Share the last live refresh when it already covers the ownership of these tasks. */
  const refreshLiveFor = (
    repoPath: WorkspaceRef,
    taskIds: string[],
    isCurrentOwner: () => boolean,
  ): Promise<void> => {
    const last = liveRefreshes.get(workspaceScopeKey(repoPath));
    const covered = taskIds.every(
      (taskId) =>
        last?.ownership.get(taskId) === readAgentSessionOwnership(queryClient, repoPath, taskId),
    );
    return last && covered ? last.done : startLiveRefresh(repoPath, isCurrentOwner);
  };

  return {
    admitExternalEvent: async (event) => {
      const scope = workspaceScopeValue(event);
      const workspaceEpoch = batch.workspaceEpoch(scope);
      const { refreshedTaskIds, removedTaskIds } = toTaskChanges(event);
      // An event that keeps a task proves that the task exists.
      batch.markExisting(scope, refreshedTaskIds);
      // A list that failed in one request with a deleted task reads again. The deletion can
      // explain the failure of the whole request.
      const failedWithDeletion = batch
        .takeFailedWith(scope, removedTaskIds)
        .filter(
          (taskId) =>
            queryClient.getQueryState(agentSessionQueryKeys.list(scope, taskId))?.status ===
            "error",
        );
      // Both start before the first await, so reads in progress learn about the change at once.
      const removal = removeAgentSessionListQueries(queryClient, scope, removedTaskIds);
      removeTaskSessions(scope, removedTaskIds);
      const refresh = refreshAgentSessionLists(queryClient, scope, [
        ...refreshedTaskIds,
        ...failedWithDeletion,
      ]);
      try {
        const [, changedTaskIds] = await Promise.all([removal, refresh]);
        return { repoPath: scope, changedTaskIds };
      } catch (error) {
        // The release of a workspace that closed cancelled these reads. Their result does not matter.
        if (batch.workspaceEpoch(scope) !== workspaceEpoch) {
          return { repoPath: scope, changedTaskIds: [] };
        }
        throw error;
      }
    },
    completeExternalEvents: async (changes, isCurrentOwner) => {
      const results = await Promise.all(changes);
      // A stopped stream or a replacement snapshot supersedes the work of the older owner.
      if (!isCurrentOwner()) return;
      const changedTaskIdsByRepo = new Map<string, { scope: WorkspaceRef; taskIds: Set<string> }>();
      for (const { repoPath, changedTaskIds } of results) {
        if (changedTaskIds.length === 0 || !isWorkspaceOpen(repoPath)) continue;
        const key = workspaceScopeKey(repoPath);
        const entry = changedTaskIdsByRepo.get(key) ?? {
          scope: repoPath,
          taskIds: new Set<string>(),
        };
        const repoTaskIds = entry.taskIds;
        for (const taskId of changedTaskIds) repoTaskIds.add(taskId);
        changedTaskIdsByRepo.set(key, entry);
      }
      await Promise.all(
        [...changedTaskIdsByRepo.values()].map(({ scope, taskIds }) =>
          refreshLiveFor(scope, [...taskIds], isCurrentOwner),
        ),
      );
    },
    cancelReads: () => {
      liveRefreshes.clear();
      void cancelAgentSessionListReads(queryClient);
    },
    reconcileStreamSnapshot: async (taskIdsByRepo, isCurrentOwner) => {
      const failures = new Map<WorkspaceRef, unknown>();
      /**
       * Run the work of each open workspace. Keep the workspaces whose work succeeded, and record
       * the cause of each other workspace. A release during the work supersedes its result.
       */
      const runForOpenRepos = async <Repo extends { repoPath: WorkspaceRef }, Result>(
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
      liveRefreshes.clear();
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
        await runForOpenRepos(loaded, ({ repoPath }) => startLiveRefresh(repoPath, isCurrentOwner));
      }
      return failures;
    },
    releaseWorkspace: (repoPath) => {
      liveRefreshes.delete(workspaceScopeKey(repoPath));
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
