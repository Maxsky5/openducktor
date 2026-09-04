import type { ExternalTaskSyncEvent } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import {
  type AgentSessionReadPort,
  loadAgentSessionListsFromQuery,
  removeAgentSessionListQueries,
  refreshAgentSessionLists,
} from "./agent-sessions";
import { taskQueryKeys } from "./tasks";

export type AgentSessionViewSync = {
  reconcileExternalEvent: (event: ExternalTaskSyncEvent) => Promise<void>;
  reconcileStreamSnapshot: (activeRepoPath: string | null) => Promise<void>;
};

export const createAgentSessionViewSync = ({
  queryClient,
  readPort,
  removeTaskSessions,
  refreshLiveSessions,
}: {
  queryClient: QueryClient;
  readPort: AgentSessionReadPort;
  removeTaskSessions: (taskIds: string[]) => void;
  refreshLiveSessions: (repoPath: string) => Promise<void>;
}): AgentSessionViewSync => ({
  reconcileExternalEvent: async (event) => {
    const taskIds = event.kind === "external_task_created" ? [event.taskId] : event.taskIds;
    const removedTaskIds = event.kind === "external_task_created" ? [] : event.removedTaskIds;
    const removedTaskIdSet = new Set(removedTaskIds);
    const retainedTaskIds = taskIds.filter((taskId) => !removedTaskIdSet.has(taskId));
    await removeAgentSessionListQueries(queryClient, event.repoPath, removedTaskIds);
    removeTaskSessions(removedTaskIds);
    const ownershipChanged = await refreshAgentSessionLists(
      queryClient,
      event.repoPath,
      retainedTaskIds,
    );
    if (ownershipChanged) {
      await refreshLiveSessions(event.repoPath);
    }
  },
  reconcileStreamSnapshot: async (activeRepoPath) => {
    if (!activeRepoPath) {
      return;
    }
    const taskIds = queryClient
      .getQueriesData<{ tasks: Array<{ id: string }> }>({
        queryKey: taskQueryKeys.repoDataPrefix(activeRepoPath),
        type: "active",
      })
      .flatMap(([, data]) => data?.tasks.map((task) => task.id) ?? []);
    await loadAgentSessionListsFromQuery(queryClient, activeRepoPath, taskIds, {
      forceFresh: true,
      readPort,
    });
    await refreshLiveSessions(activeRepoPath);
  },
});
