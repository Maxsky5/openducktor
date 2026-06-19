import type { PropsWithChildren, ReactElement } from "react";
import {
  useChecksOperationsContext,
  useRequiredContext,
  useTaskControlContext,
  useWorkspaceOperationsContext,
  WorkspaceStateContext,
} from "../app-state-contexts";
import { useAppLifecycle } from "../lifecycle/use-app-lifecycle";

type AppLifecycleStateProviderProps = PropsWithChildren;

export function AppLifecycleStateProvider({
  children,
}: AppLifecycleStateProviderProps): ReactElement {
  const { activeWorkspace } = useRequiredContext(
    WorkspaceStateContext,
    "AppLifecycleStateProvider",
  );
  const { refreshBranches, clearBranchData } = useWorkspaceOperationsContext();
  const { refreshRuntimeCheck, refreshTaskStoreCheckForRepo } = useChecksOperationsContext();
  const { refreshTaskData } = useTaskControlContext();

  useAppLifecycle({
    activeWorkspace,
    refreshBranches,
    refreshRuntimeCheck,
    refreshTaskStoreCheckForRepo,
    refreshTaskData,
    clearBranchData,
  });

  return <>{children}</>;
}
