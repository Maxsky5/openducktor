import type { PropsWithChildren, ReactElement } from "react";
import {
  useChecksOperationsContext,
  useRequiredContext,
  useTaskControlContext,
  useWorkspaceOperationsContext,
  WorkspaceStateContext,
} from "../app-state-contexts";
import { useAppLifecycle } from "../lifecycle/use-app-lifecycle";

export function AppLifecycleStateProvider({ children }: PropsWithChildren): ReactElement {
  const { activeWorkspace } = useRequiredContext(
    WorkspaceStateContext,
    "AppLifecycleStateProvider",
  );
  const { refreshWorkspaces, refreshBranches, clearBranchData } = useWorkspaceOperationsContext();
  const { refreshRuntimeCheck, refreshBeadsCheckForRepo } = useChecksOperationsContext();
  const { refreshTaskData } = useTaskControlContext();

  useAppLifecycle({
    activeWorkspace,
    refreshWorkspaces,
    refreshBranches,
    refreshRuntimeCheck,
    refreshBeadsCheckForRepo,
    refreshTaskData,
    clearBranchData,
  });

  return <>{children}</>;
}
