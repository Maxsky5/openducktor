import type { RuntimeInstanceSummary, RuntimeKind } from "@openducktor/contracts";
import type { PropsWithChildren, ReactElement } from "react";
import {
  useChecksOperationsContext,
  useRepoRuntimeHealthContext,
  useRequiredContext,
  useRuntimeAvailabilityContext,
  useTaskControlContext,
  useWorkspaceOperationsContext,
  WorkspaceStateContext,
} from "../app-state-contexts";
import { useAppLifecycle } from "../lifecycle/use-app-lifecycle";

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
  const { refreshTaskData } = useTaskControlContext();

  useAppLifecycle({
    activeWorkspace,
    runtimeDefinitions: availableRuntimeDefinitions,
    refreshBranches,
    refreshRepoRuntimeHealth,
    refreshTaskStoreCheckForRepo,
    refreshTaskData,
    startRepoRuntime,
    clearBranchData,
  });

  return <>{children}</>;
}
