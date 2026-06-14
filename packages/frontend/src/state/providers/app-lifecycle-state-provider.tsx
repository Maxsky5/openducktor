import type { RuntimeKind } from "@openducktor/contracts";
import type { PropsWithChildren, ReactElement } from "react";
import {
  useChecksOperationsContext,
  useRequiredContext,
  useRuntimeAvailabilityContext,
  useTaskControlContext,
  useWorkspaceOperationsContext,
  WorkspaceStateContext,
} from "../app-state-contexts";
import { useAppLifecycle } from "../lifecycle/use-app-lifecycle";

type AppLifecycleStateProviderProps = PropsWithChildren<{
  startRepoRuntime: (repoPath: string, runtimeKind: RuntimeKind) => Promise<void>;
}>;

export function AppLifecycleStateProvider({
  children,
  startRepoRuntime,
}: AppLifecycleStateProviderProps): ReactElement {
  const { activeWorkspace } = useRequiredContext(
    WorkspaceStateContext,
    "AppLifecycleStateProvider",
  );
  const { refreshWorkspaces, refreshBranches, clearBranchData } = useWorkspaceOperationsContext();
  const { availableRuntimeDefinitions } = useRuntimeAvailabilityContext();
  const { refreshRuntimeCheck, refreshTaskStoreCheckForRepo, refreshRepoRuntimeHealthForRepo } =
    useChecksOperationsContext();
  const { refreshTaskData } = useTaskControlContext();

  useAppLifecycle({
    activeWorkspace,
    runtimeDefinitions: availableRuntimeDefinitions,
    refreshWorkspaces,
    refreshBranches,
    refreshRuntimeCheck,
    refreshTaskStoreCheckForRepo,
    refreshRepoRuntimeHealthForRepo,
    refreshTaskData,
    startRepoRuntime,
    clearBranchData,
  });

  return <>{children}</>;
}
