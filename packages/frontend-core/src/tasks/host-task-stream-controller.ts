import type { QueryClient } from "@tanstack/react-query";
import type { HostConnection } from "../connection/host-connection";
import { createAgentSessionViewSync } from "../queries/agent-session-view-sync";
import { getProductionTaskViewSync } from "../queries/task-view-sync";
import type { AgentSessionsStore } from "../sessions/agent-sessions-store";
import { createTaskStreamController, type TaskStreamController } from "./task-stream-controller";

export type HostTaskStreamInput = {
  queryClient: QueryClient;
  getOpenRepoPaths: () => readonly string[];
  getActiveRepoPath: () => string | null;
  onDegraded: (cause: unknown) => void;
  onSnapshotFinished?: (repoPath: string, succeeded: boolean) => void;
  onSnapshotStarted?: (repoPath: string) => void;
  onWorkspaceFailures: (failures: ReadonlyMap<string, unknown>) => void;
};

/**
 * The task stream of a host connection. It keeps the cached task lists, documents, and session
 * lists of the open workspaces current with the task events of the host.
 */
export const createHostTaskStreamController = (
  host: HostConnection,
  sessionStore: Pick<AgentSessionsStore, "listSessionTaskIds" | "removeTaskSessions">,
  { queryClient, getOpenRepoPaths, getActiveRepoPath, ...callbacks }: HostTaskStreamInput,
): TaskStreamController =>
  createTaskStreamController({
    transport: host,
    taskViewSync: getProductionTaskViewSync(queryClient),
    agentSessionViewSync: createAgentSessionViewSync({
      queryClient,
      readPort: host.client,
      listSessionTaskIds: sessionStore.listSessionTaskIds,
      removeTaskSessions: sessionStore.removeTaskSessions,
      refreshLiveSessions: (repoPath) => host.client.agentSessionLiveRefresh({ repoPath }),
      isWorkspaceOpen: (repoPath) => getOpenRepoPaths().includes(repoPath),
      isWorkspaceActive: (repoPath) => getActiveRepoPath() === repoPath,
    }),
    getOpenRepoPaths,
    ...callbacks,
  });
