import { type PropsWithChildren, type ReactElement, useMemo } from "react";
import { useRuntimeCatalogBootstrap } from "@/state/lifecycle/use-runtime-catalog-bootstrap";
import { createAgentSessionViewSync } from "@openducktor/frontend-core/queries/agent-session-view-sync";
import { getProductionTaskViewSync } from "@openducktor/frontend-core/queries/task-view-sync";
import { createTaskStreamController } from "@openducktor/frontend-core/tasks/task-stream-controller";
import type { AgentSessionsStore } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import {
  useChecksOperationsContext,
  useRequiredContext,
  useRuntimeAvailabilityContext,
  useTaskControlContext,
  useWorkspaceOperationsContext,
  WorkspaceStateContext,
} from "../app-state-contexts";
import {
  useAgentSessionsContext,
  useHostRuntimeStatusContext,
} from "@openducktor/frontend-core/sessions/session-contexts";
import { useHostConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import type { HostConnection } from "@openducktor/frontend-core/connection/host-connection";
import { type TaskStreamControllerFactory, useAppLifecycle } from "../lifecycle/use-app-lifecycle";

const createProductionTaskStreamController =
  (
    host: HostConnection,
    sessionStore: Pick<AgentSessionsStore, "listSessionTaskIds" | "removeTaskSessions">,
  ): TaskStreamControllerFactory =>
  ({
    queryClient,
    getOpenRepoPaths,
    getActiveRepoPath,
    onDegraded,
    onSnapshotFinished,
    onSnapshotStarted,
    onWorkspaceFailures,
  }) =>
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
      onDegraded,
      onSnapshotFinished,
      onSnapshotStarted,
      onWorkspaceFailures,
    });

export function AppLifecycleStateProvider({ children }: PropsWithChildren): ReactElement {
  const { activeWorkspace, workspaces } = useRequiredContext(
    WorkspaceStateContext,
    "AppLifecycleStateProvider",
  );
  const { refreshBranches, clearBranchData } = useWorkspaceOperationsContext();
  const { availableRuntimeDefinitions, loadRepoRuntimeCatalog } = useRuntimeAvailabilityContext();
  const runtimeStatus = useHostRuntimeStatusContext();
  const { refreshTaskStoreCheckForRepo } = useChecksOperationsContext();
  const { loadWorkspaceTasks } = useTaskControlContext();
  const { listSessionTaskIds, removeTaskSessions } = useAgentSessionsContext();
  const host = useHostConnection();
  const taskStreamControllerFactory = useMemo(
    () => createProductionTaskStreamController(host, { listSessionTaskIds, removeTaskSessions }),
    [host, listSessionTaskIds, removeTaskSessions],
  );

  useRuntimeCatalogBootstrap({
    activeWorkspace,
    availableRuntimeDefinitions,
    runtimeStatus,
    loadRepoRuntimeCatalog,
  });

  useAppLifecycle({
    activeWorkspace,
    openWorkspaces: workspaces,
    refreshBranches,
    refreshTaskStoreCheckForRepo,
    loadWorkspaceTasks,
    clearBranchData,
    taskStreamControllerFactory,
  });

  return <>{children}</>;
}
