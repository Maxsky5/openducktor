import type { RuntimeInstanceSummary, RuntimeKind } from "@openducktor/contracts";
import { type PropsWithChildren, type ReactElement, useMemo } from "react";
import { hostBridge, hostClient } from "@/lib/host-client";
import { createAgentSessionViewSync } from "@/state/queries/agent-session-view-sync";
import { getProductionTaskViewSync } from "@/state/queries/task-view-sync";
import { createTaskStreamController } from "@/state/tasks/task-stream-controller";
import {
  useAgentSessionsContext,
  useChecksOperationsContext,
  useRepoRuntimeHealthContext,
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
  ({ queryClient, getActiveRepoPath, onDegraded, onInitialSnapshotStarted }) => {
    const taskViewSync = getProductionTaskViewSync(queryClient);
    let initialSnapshotStarted = false;
    return createTaskStreamController({
      transport: hostBridge,
      metadata: hostClient,
      taskViewSync: {
        ...taskViewSync,
        reconcileStreamSnapshot: (activeRepoPath) => {
          const snapshot = taskViewSync.reconcileStreamSnapshot(activeRepoPath);
          if (!initialSnapshotStarted) {
            initialSnapshotStarted = true;
            onInitialSnapshotStarted();
          }
          return snapshot;
        },
      },
      agentSessionViewSync: createAgentSessionViewSync({
        queryClient,
        readPort: hostClient,
        removeTaskSessions,
        refreshLiveSessions: (repoPath) => hostClient.agentSessionLiveRefresh({ repoPath }),
      }),
      getActiveRepoPath,
      onDegraded,
    });
  };

type AppLifecycleStateProviderProps = PropsWithChildren<{
  startRepoRuntime: (repoPath: string, runtimeKind: RuntimeKind) => Promise<RuntimeInstanceSummary>;
}>;

export function AppLifecycleStateProvider({
  children,
  startRepoRuntime,
}: AppLifecycleStateProviderProps): ReactElement {
  const { activeWorkspace } = useRequiredContext(
    WorkspaceStateContext,
    "AppLifecycleStateProvider",
  );
  const { refreshBranches, clearBranchData } = useWorkspaceOperationsContext();
  const { availableRuntimeDefinitions } = useRuntimeAvailabilityContext();
  const { refreshRepoRuntimeHealth } = useRepoRuntimeHealthContext();
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

  useAppLifecycle({
    activeWorkspace,
    runtimeDefinitions: availableRuntimeDefinitions,
    refreshBranches,
    refreshRepoRuntimeHealth,
    refreshTaskStoreCheckForRepo,
    loadWorkspaceTasks,
    startRepoRuntime,
    clearBranchData,
    taskStreamControllerFactory,
  });

  return <>{children}</>;
}
