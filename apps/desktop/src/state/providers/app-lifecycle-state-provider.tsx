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
  const {
    refreshRuntimeCheck,
    refreshBeadsCheckForRepo,
    refreshRepoOpencodeHealthForRepo,
    clearActiveBeadsCheck,
    clearActiveRepoOpencodeHealth,
    setIsLoadingChecks,
    hasRuntimeCheck,
    hasCachedBeadsCheck,
    hasCachedRepoOpencodeHealth,
  } = useChecksOperationsContext();
  const { refreshTaskData, clearTaskData, setIsLoadingTasks } = useTaskControlContext();
  const { setEvents, setRunCompletionSignal } = useDelegationEventsContext();

  useAppLifecycle({
    activeRepo,
    setEvents,
    setRunCompletionSignal,
    refreshWorkspaces,
    refreshBranches,
    refreshRuntimeCheck,
    refreshBeadsCheckForRepo,
    refreshRepoOpencodeHealthForRepo,
    refreshTaskData,
    clearTaskData,
    clearBranchData,
    clearActiveBeadsCheck,
    clearActiveRepoOpencodeHealth,
    setIsLoadingChecks,
    setIsLoadingTasks,
    hasRuntimeCheck,
    hasCachedBeadsCheck,
    hasCachedRepoOpencodeHealth,
  });

  return <>{children}</>;
}
