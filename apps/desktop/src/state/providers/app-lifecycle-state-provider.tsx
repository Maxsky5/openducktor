import type { PropsWithChildren, ReactElement } from "react";
import {
  useActiveRepoContext,
  useChecksOperationsContext,
  useDelegationEventsContext,
  useTaskControlContext,
  useWorkspaceOperationsContext,
} from "../app-state-contexts";
import { useAppLifecycle } from "../lifecycle/use-app-lifecycle";

export function AppLifecycleStateProvider({ children }: PropsWithChildren): ReactElement {
  const { activeRepo } = useActiveRepoContext();
  const { refreshWorkspaces, refreshBranches, clearBranchData } = useWorkspaceOperationsContext();
  const { refreshRuntimeCheck, refreshBeadsCheckForRepo } = useChecksOperationsContext();
  const { refreshTaskData, refreshTasksWithOptions } = useTaskControlContext();
  const { setEvents, setRunCompletionSignal } = useDelegationEventsContext();

  useAppLifecycle({
    activeRepo,
    setEvents,
    setRunCompletionSignal,
    refreshWorkspaces,
    refreshBranches,
    refreshRuntimeCheck,
    refreshBeadsCheckForRepo,
    refreshTaskData,
    refreshTasksWithOptions,
    clearBranchData,
  });

  return <>{children}</>;
}
