import type { ExternalTaskSyncEvent } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { refreshAgentSessionLists } from "./agent-sessions";

export type AgentSessionViewSync = {
  reconcileExternalEvent: (event: ExternalTaskSyncEvent) => Promise<void>;
};

export const createAgentSessionViewSync = ({
  queryClient,
  refreshLiveSessions,
}: {
  queryClient: QueryClient;
  refreshLiveSessions: (repoPath: string) => Promise<void>;
}): AgentSessionViewSync => ({
  reconcileExternalEvent: async (event) => {
    const taskIds = event.kind === "external_task_created" ? [event.taskId] : event.taskIds;
    const removedTaskIds = event.kind === "external_task_created" ? [] : event.removedTaskIds;
    const removedTaskIdSet = new Set(removedTaskIds);
    const retainedTaskIds = taskIds.filter((taskId) => !removedTaskIdSet.has(taskId));
    const ownershipChanged = await refreshAgentSessionLists(
      queryClient,
      event.repoPath,
      retainedTaskIds,
    );
    if (ownershipChanged) {
      await refreshLiveSessions(event.repoPath);
    }
  },
});
