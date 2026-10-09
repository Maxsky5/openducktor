import type { ExternalTaskSyncEvent } from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { CancelledError, type QueryClient } from "@tanstack/react-query";

import { getSessionReads, type SessionReadCommit } from "./agent-session-reads";
import {
  agentSessionQueryKeys,
  type AgentSessionReadPort,
  cachedAgentSessionTaskIds,
  loadAgentSessionListsFromQuery,
  removeAgentSessionListQueries,
  refreshAgentSessionLists,
} from "./agent-sessions";
import { loadExistingTaskIdsFromQuery, taskQueryKeys } from "./tasks";

export type AgentSessionViewReadPort = AgentSessionReadPort & Pick<HostClient, "tasksExistingIds">;

export type AgentSessionViewSync = {
  reconcileExternalEvent: (event: ExternalTaskSyncEvent) => Promise<void>;
  reconcileStreamSnapshot: (activeRepoPath: string | null, taskIds: string[]) => Promise<void>;
  stopPending: (reason: "snapshot" | "stop") => void;
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
}): AgentSessionViewSync => {
  const reads = getSessionReads(queryClient);
  let owner = new AbortController();
  const refreshes = new WeakMap<SessionReadCommit, Promise<void>>();
  const workspaceRefreshes = new Map<string, Promise<void>>();

  const refreshLive = (commit: SessionReadCommit, signal: AbortSignal): Promise<void> => {
    if (!commit.ownershipChanged || signal.aborted) return Promise.resolve();
    const existing = refreshes.get(commit);
    if (existing) return existing;
    // An older failure must not block the next live refresh.
    const previous = workspaceRefreshes.get(commit.repoPath) ?? Promise.resolve();
    const refresh = previous
      .catch(() => {})
      .then(async () => {
        if (!signal.aborted) await refreshLiveSessions(commit.repoPath);
      });
    refreshes.set(commit, refresh);
    workspaceRefreshes.set(commit.repoPath, refresh);
    void refresh
      .finally(() => {
        if (workspaceRefreshes.get(commit.repoPath) === refresh)
          workspaceRefreshes.delete(commit.repoPath);
      })
      .catch(() => {});
    return refresh;
  };

  return {
    stopPending: (reason) => {
      owner.abort();
      owner = new AbortController();
      if (reason === "snapshot") {
        reads.cancel();
        void queryClient.cancelQueries({ queryKey: taskQueryKeys.existingIdsPrefix() });
      }
    },
    reconcileExternalEvent: (event) => {
      const signal = owner.signal;
      const taskIds = event.kind === "external_task_created" ? [event.taskId] : event.taskIds;
      const removedTaskIds = event.kind === "external_task_created" ? [] : event.removedTaskIds;
      const removed = new Set(removedTaskIds);
      const retained = taskIds.filter((taskId) => !removed.has(taskId));
      if (event.kind === "external_task_created") reads.restore(event.repoPath, retained);
      // Mark removals and changed tasks before the next event can start.
      const removal = removeAgentSessionListQueries(queryClient, event.repoPath, removedTaskIds);
      removeTaskSessions(event.repoPath, removedTaskIds);
      const refresh = refreshAgentSessionLists(queryClient, event.repoPath, retained, readPort);
      return waitOrStop(
        (async () => {
          await removal;
          const commits = await refresh;
          if (signal.aborted) return;
          await Promise.all(commits.map((commit) => refreshLive(commit, signal)));
        })(),
        signal,
      );
    },
    reconcileStreamSnapshot: (activeRepoPath, taskIds) => {
      const signal = owner.signal;
      const inactive = queryClient.getQueryCache().findAll({
        queryKey: agentSessionQueryKeys.all,
        type: "active",
        predicate: (query) => query.queryKey[1] === "list" && query.queryKey[2] !== activeRepoPath,
      });
      // The sidebar observes other workspaces while the task stream restores the active one.
      const refreshInactive = Promise.all(
        inactive.map((query) =>
          queryClient.refetchQueries({ queryKey: query.queryKey, exact: true }),
        ),
      );
      const refreshActive = (async () => {
        if (!activeRepoPath) return;
        const scope = new Set(taskIds);
        const knownTaskIds = new Set([
          ...reads.knownTaskIds(activeRepoPath),
          ...cachedAgentSessionTaskIds(queryClient, activeRepoPath),
        ]);
        // The Kanban list omits closed tasks. Only the task store can confirm their deletion.
        const unlisted = [...knownTaskIds].filter(
          (taskId) => !scope.has(taskId) && !reads.isDeleted(activeRepoPath, taskId),
        );
        const existing = new Set(
          unlisted.length > 0
            ? await loadExistingTaskIdsFromQuery(queryClient, activeRepoPath, unlisted, readPort)
            : [],
        );
        if (signal.aborted) return;
        const removed = unlisted.filter((taskId) => !existing.has(taskId));
        await removeAgentSessionListQueries(queryClient, activeRepoPath, removed);
        if (signal.aborted) return;
        removeTaskSessions(activeRepoPath, removed);
        reads.restore(activeRepoPath, [...taskIds, ...existing]);
        await loadAgentSessionListsFromQuery(queryClient, activeRepoPath, taskIds, {
          forceFresh: true,
          readPort,
        });
        if (!signal.aborted) await refreshLiveSessions(activeRepoPath);
      })();
      return waitOrStop(
        Promise.all([refreshInactive, refreshActive]).then(() => {}),
        signal,
      );
    },
  };
};

/** Stop waiting on an old view while its host request keeps the workspace slot. */
async function waitOrStop(operation: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new CancelledError({ revert: true });
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new CancelledError({ revert: true }));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    await Promise.race([operation, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
