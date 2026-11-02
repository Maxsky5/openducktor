import type { WorkspaceRef } from "@openducktor/contracts";
import { workspaceScopeKey } from "../queries/workspace-scope";
import type { QueryClient } from "@tanstack/react-query";
import type { HostConnection } from "../connection/host-connection";
import { createAgentSessionViewSync } from "../queries/agent-session-view-sync";
import { getProductionTaskViewSync } from "../queries/task-view-sync";
import type { AgentSessionsStore } from "../sessions/agent-sessions-store";
import { createTaskStreamController, type TaskStreamController } from "./task-stream-controller";

export type HostTaskStreamInput = {
  queryClient: QueryClient;
  getOpenRepoPaths: () => readonly WorkspaceRef[];
  getActiveRepoPath: () => WorkspaceRef | null;
  onDegraded: (cause: unknown) => void;
  onSnapshotFinished?: (repoPath: WorkspaceRef, succeeded: boolean) => void;
  onSnapshotStarted?: (repoPath: WorkspaceRef) => void;
  onWorkspaceFailures: (failures: ReadonlyMap<WorkspaceRef, unknown>) => void;
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
      listSessionTaskIds: (scope) => sessionStore.listSessionTaskIds(scope),
      removeTaskSessions: (scope, taskIds) => sessionStore.removeTaskSessions(scope, taskIds),
      refreshLiveSessions: (repoPath) =>
        host.client.agentSessionLiveRefresh({ repoPath: repoPath.repoPath }),
      isWorkspaceOpen: (repoPath) =>
        getOpenRepoPaths().some(
          (scope) => workspaceScopeKey(scope) === workspaceScopeKey(repoPath),
        ),
      isWorkspaceActive: (repoPath) =>
        getActiveRepoPath()?.workspaceId === repoPath.workspaceId &&
        getActiveRepoPath()?.repoPath === repoPath.repoPath,
    }),
    getOpenRepoPaths,
    ...callbacks,
  });
