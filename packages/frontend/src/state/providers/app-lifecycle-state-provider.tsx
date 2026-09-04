import type { RuntimeInstanceSummary, RuntimeKind } from "@openducktor/contracts";
import type { PropsWithChildren, ReactElement } from "react";
import { hostBridge, hostClient } from "@/lib/host-client";
import { createAgentSessionViewSync } from "@/state/queries/agent-session-view-sync";
import { getProductionTaskViewSync } from "@/state/queries/task-view-sync";
import { createTaskStreamController } from "@/state/tasks/task-stream-controller";
import {
  useChecksOperationsContext,
  useRepoRuntimeHealthContext,
  useRequiredContext,
  useRuntimeAvailabilityContext,
  useTaskControlContext,
  useWorkspaceOperationsContext,
  WorkspaceStateContext,
} from "../app-state-contexts";
import { type TaskStreamControllerFactory, useAppLifecycle } from "../lifecycle/use-app-lifecycle";

const createProductionTaskStreamController: TaskStreamControllerFactory = ({
  queryClient,
  getActiveRepoPath,
  onDegraded,
}) =>
  createTaskStreamController({
    transport: hostBridge,
    metadata: hostClient,
    taskViewSync: getProductionTaskViewSync(queryClient),
    agentSessionViewSync: createAgentSessionViewSync({
      queryClient,
      refreshLiveSessions: (repoPath) => hostClient.agentSessionLiveRefresh({ repoPath }),
    }),
    getActiveRepoPath,
    onDegraded,
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

  useAppLifecycle({
    activeWorkspace,
    runtimeDefinitions: availableRuntimeDefinitions,
    refreshBranches,
    refreshRepoRuntimeHealth,
    refreshTaskStoreCheckForRepo,
    loadWorkspaceTasks,
    startRepoRuntime,
    clearBranchData,
    taskStreamControllerFactory: createProductionTaskStreamController,
  });

  return <>{children}</>;
}
