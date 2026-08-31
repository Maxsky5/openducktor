import type { RuntimeInstanceSummary, RuntimeKind } from "@openducktor/contracts";
import { type PropsWithChildren, type ReactElement, useMemo } from "react";
import { hostBridge, hostClient } from "@/lib/host-client";
import { createAgentSessionViewSync } from "@/state/queries/agent-session-view-sync";
import { getProductionTaskViewSync } from "@/state/queries/task-view-sync";
import { createTaskStreamController } from "@/state/tasks/task-stream-controller";
import type { TaskStreamNotificationSink } from "@/state/tasks/task-stream-controller";
import { useNotificationContext } from "../notifications/notification-context";
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
    notificationSink: TaskStreamNotificationSink,
  ): TaskStreamControllerFactory =>
  ({ queryClient, getActiveRepoPath, onDegraded, onSnapshotFinished, onSnapshotStarted }) =>
    createTaskStreamController({
      transport: hostBridge,
      metadata: hostClient,
      taskViewSync: getProductionTaskViewSync(queryClient),
      agentSessionViewSync: createAgentSessionViewSync({
        queryClient,
        readPort: hostClient,
        removeTaskSessions,
        refreshLiveSessions: (repoPath) => hostClient.agentSessionLiveRefresh({ repoPath }),
      }),
      getActiveRepoPath,
      notificationSink,
      onDegraded,
      onSnapshotFinished,
      onSnapshotStarted,
    });

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
  const { taskStreamSink } = useNotificationContext();
  const taskStreamControllerFactory = useMemo(
    () =>
      createProductionTaskStreamController(
        (repoPath, taskIds) => {
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
        },
        taskStreamSink,
      ),
    [sessionStore, taskStreamSink],
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
