import type { PropsWithChildren, ReactElement } from "react";
import {
  useActiveRepoContext,
  useChecksOperationsContext,
  useDelegationEventsContext,
  useRuntimeDefinitionsContext,
  useTaskControlContext,
  useWorkspaceOperationsContext,
} from "../app-state-contexts";
import { useAppLifecycle } from "../lifecycle/use-app-lifecycle";

export function AppLifecycleStateProvider({ children }: PropsWithChildren): ReactElement {
  const { activeRepo } = useActiveRepoContext();
  const { runtimeDefinitions } = useRuntimeDefinitionsContext();
  const { refreshWorkspaces, refreshBranches, clearBranchData } = useWorkspaceOperationsContext();
  const {
    refreshRuntimeCheck,
    refreshBeadsCheckForRepo,
    refreshRepoRuntimeHealthForRepo,
    clearActiveBeadsCheck,
    clearActiveRepoRuntimeHealth,
    setIsLoadingChecks,
    hasRuntimeCheck,
    hasCachedBeadsCheck,
    hasCachedRepoRuntimeHealth,
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
    refreshRepoRuntimeHealthForRepo,
    runtimeKinds: runtimeDefinitions.map((definition) => definition.kind),
    refreshTaskData,
    clearTaskData,
    clearBranchData,
    clearActiveBeadsCheck,
    clearActiveRepoRuntimeHealth,
    setIsLoadingChecks,
    setIsLoadingTasks,
    hasRuntimeCheck,
    hasCachedBeadsCheck,
    hasCachedRepoRuntimeHealth,
  });

  return <>{children}</>;
}
