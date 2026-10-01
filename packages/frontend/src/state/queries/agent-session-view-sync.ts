import type { ExternalTaskSyncEvent } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  agentSessionQueryKeys,
  type AgentSessionReadPort,
  loadAgentSessionListsFromQuery,
  removeAgentSessionListQueries,
  refreshAgentSessionLists,
} from "./agent-sessions";

const queryKeyStringSchema = z.string();

export type AgentSessionViewSync = {
  reconcileExternalEvent: (event: ExternalTaskSyncEvent) => Promise<void>;
  reconcileStreamSnapshot: (activeRepoPath: string | null, taskIds: string[]) => Promise<void>;
};

export const createAgentSessionViewSync = ({
  queryClient,
  readPort,
  removeTaskSessions,
  refreshLiveSessions,
}: {
  queryClient: QueryClient;
  readPort: AgentSessionReadPort;
  removeTaskSessions: (repoPath: string, taskIds: string[]) => void;
  refreshLiveSessions: (repoPath: string) => Promise<void>;
}): AgentSessionViewSync => ({
  reconcileExternalEvent: async (event) => {
    const taskIds = event.kind === "external_task_created" ? [event.taskId] : event.taskIds;
    const removedTaskIds = event.kind === "external_task_created" ? [] : event.removedTaskIds;
    const removedTaskIdSet = new Set(removedTaskIds);
    const retainedTaskIds = taskIds.filter((taskId) => !removedTaskIdSet.has(taskId));
    await removeAgentSessionListQueries(queryClient, event.repoPath, removedTaskIds);
    removeTaskSessions(event.repoPath, removedTaskIds);
    const ownershipChanged = await refreshAgentSessionLists(
      queryClient,
      event.repoPath,
      retainedTaskIds,
    );
    if (ownershipChanged) {
      await refreshLiveSessions(event.repoPath);
    }
  },
  reconcileStreamSnapshot: async (activeRepoPath, taskIds) => {
    const taskIdSet = new Set(taskIds);
    const removedTaskIds = activeRepoPath
      ? cachedAgentSessionTaskIds(queryClient, activeRepoPath).filter(
          (taskId) => !taskIdSet.has(taskId),
        )
      : [];
    await queryClient.cancelQueries({ queryKey: agentSessionQueryKeys.all, exact: false });
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
    removeTaskSessions(activeRepoPath, removedTaskIds);
    await Promise.all([
      inactiveRefetches,
      loadAgentSessionListsFromQuery(queryClient, activeRepoPath, taskIds, {
        forceFresh: true,
        readPort,
      }),
    ]);
    await refreshLiveSessions(activeRepoPath);
  },
});

function cachedAgentSessionTaskIds(queryClient: QueryClient, repoPath: string): string[] {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: agentSessionQueryKeys.all, exact: false })
    .flatMap((query) => {
      const [, kind, cachedRepoPath, taskId] = query.queryKey;
      const taskIdResult = queryKeyStringSchema.safeParse(taskId);
      return kind === "list" && cachedRepoPath === repoPath && taskIdResult.success
        ? [taskIdResult.data]
        : [];
    });
}
