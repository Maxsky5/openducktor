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

type AgentSessionViewReadPort = AgentSessionReadPort & {
  tasksList: (repoPath: string) => Promise<Array<{ id: string }>>;
};

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
  readPort: AgentSessionViewReadPort;
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
  reconcileStreamSnapshot: async (activeRepoPath) => {
    const tasks = activeRepoPath ? await readPort.tasksList(activeRepoPath) : [];
    const taskIds = tasks.map((task) => task.id);
    const taskIdSet = new Set(taskIds);
    const removedTaskIds = activeRepoPath
      ? cachedAgentSessionTaskIds(queryClient, activeRepoPath).filter(
          (taskId) => !taskIdSet.has(taskId),
        )
      : [];
    await queryClient.cancelQueries({ queryKey: agentSessionQueryKeys.all, exact: false });
    queryClient.removeQueries({ queryKey: agentSessionQueryKeys.all, exact: false });
    if (!activeRepoPath) {
      return;
    }
    removeTaskSessions(activeRepoPath, removedTaskIds);
    await loadAgentSessionListsFromQuery(queryClient, activeRepoPath, taskIds, {
      forceFresh: true,
      readPort,
    });
    await refreshLiveSessions(activeRepoPath);
  },
});

function cachedAgentSessionTaskIds(queryClient: QueryClient, repoPath: string): string[] {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: agentSessionQueryKeys.all, exact: false })
    .flatMap((query) => {
      const [, kind, cachedRepoPath, taskId] = query.queryKey;
      const taskIdResult = z.string().safeParse(taskId);
      return kind === "list" && cachedRepoPath === repoPath && taskIdResult.success
        ? [taskIdResult.data]
        : [];
    });
}
