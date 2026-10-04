import { type PropsWithChildren, type ReactElement, useMemo } from "react";
import { hostBridge, hostClient } from "@/lib/host-client";
import { useRuntimeCatalogBootstrap } from "@/state/lifecycle/use-runtime-catalog-bootstrap";
import { createAgentSessionViewSync } from "@/state/queries/agent-session-view-sync";
import { getProductionTaskViewSync } from "@/state/queries/task-view-sync";
import { createTaskStreamController } from "@/state/tasks/task-stream-controller";
import {
  useAgentSessionsContext,
  useChecksOperationsContext,
  useHostRuntimeStatusContext,
  useRequiredContext,
  useRuntimeAvailabilityContext,
  useTaskControlContext,
  useWorkspaceOperationsContext,
  WorkspaceStateContext,
} from "../app-state-contexts";
import { type TaskStreamControllerFactory, useAppLifecycle } from "../lifecycle/use-app-lifecycle";

const createProductionTaskStreamController =
  (
    removeTaskSessions: (repoPath: string, taskIds: string[]) => void,
  ): TaskStreamControllerFactory =>
  ({ queryClient, getActiveRepoPath, onDegraded, onSnapshotFinished, onSnapshotStarted }) =>
    createTaskStreamController({
      transport: hostBridge,
      taskViewSync: getProductionTaskViewSync(queryClient),
      agentSessionViewSync: createAgentSessionViewSync({
        queryClient,
        readPort: hostClient,
        removeTaskSessions,
        refreshLiveSessions: (repoPath) => hostClient.agentSessionLiveRefresh({ repoPath }),
      }),
      getActiveRepoPath,
      onDegraded,
      onSnapshotFinished,
      onSnapshotStarted,
    });

export function AppLifecycleStateProvider({ children }: PropsWithChildren): ReactElement {
  const { activeWorkspace } = useRequiredContext(
    WorkspaceStateContext,
    "AppLifecycleStateProvider",
  );
  const { refreshBranches, clearBranchData } = useWorkspaceOperationsContext();
  const { availableRuntimeDefinitions, loadRepoRuntimeCatalog } = useRuntimeAvailabilityContext();
  const runtimeStatus = useHostRuntimeStatusContext();
  const { refreshTaskStoreCheckForRepo } = useChecksOperationsContext();
  const { loadWorkspaceTasks } = useTaskControlContext();
  const sessionStore = useAgentSessionsContext();
  const taskStreamControllerFactory = useMemo(
    () =>
      createProductionTaskStreamController((repoPath, taskIds) => {
        if (sessionStore.getActivitySnapshot().workspaceRepoPath !== repoPath) {
          return;
        }
        const taskIdSet = new Set(taskIds);
        for (const session of sessionStore.listSessionSnapshots()) {
          if (
            session.sessionAssociation.kind === "workflow" &&
            taskIdSet.has(session.sessionAssociation.taskId)
          ) {
            sessionStore.removeSession(session);
          }
        }
      }),
    [sessionStore],
  );

  useRuntimeCatalogBootstrap({
    activeWorkspace,
    availableRuntimeDefinitions,
    runtimeStatus,
    loadRepoRuntimeCatalog,
  });

  useAppLifecycle({
    activeWorkspace,
    refreshBranches,
    refreshTaskStoreCheckForRepo,
    loadWorkspaceTasks,
    clearBranchData,
    taskStreamControllerFactory,
  });

  return <>{children}</>;
}
