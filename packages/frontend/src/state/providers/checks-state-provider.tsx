import { type PropsWithChildren, type ReactElement, useMemo } from "react";
import { buildChecksStateValue } from "../app-state-context-values";
import {
  ChecksOperationsContext,
  type ChecksOperationsContextValue,
  ChecksStateContext,
  useActiveWorkspaceContext,
  useHostRuntimeStatusContext,
  useRuntimeAvailabilityContext,
} from "../app-state-contexts";
import { useChecks } from "../operations/workspace/use-checks";

type ChecksStateProviderProps = PropsWithChildren;

export function ChecksStateProvider({ children }: ChecksStateProviderProps): ReactElement {
  const { activeWorkspace } = useActiveWorkspaceContext();
  const { availableRuntimeDefinitions } = useRuntimeAvailabilityContext();
  const { refresh: refreshHostRuntimeStatus } = useHostRuntimeStatusContext();
  const {
    runtimeCheck,
    checksRepoPath,
    taskStoreCheck,
    isRefreshingChecks,
    refreshTaskStoreCheckForRepo,
    refreshChecks,
  } = useChecks({
    activeWorkspace,
    runtimeDefinitions: availableRuntimeDefinitions,
    refreshHostRuntimeStatus,
  });

  const checksStateValue = useMemo(
    () =>
      buildChecksStateValue({
        runtimeCheck,
        checksRepoPath,
        taskStoreCheck,
        isRefreshingChecks,
        refreshChecks,
      }),
    [checksRepoPath, isRefreshingChecks, refreshChecks, runtimeCheck, taskStoreCheck],
  );

  const checksOperationsValue = useMemo<ChecksOperationsContextValue>(
    () => ({ refreshTaskStoreCheckForRepo }),
    [refreshTaskStoreCheckForRepo],
  );

  return (
    <ChecksOperationsContext.Provider value={checksOperationsValue}>
      <ChecksStateContext.Provider value={checksStateValue}>{children}</ChecksStateContext.Provider>
    </ChecksOperationsContext.Provider>
  );
}
