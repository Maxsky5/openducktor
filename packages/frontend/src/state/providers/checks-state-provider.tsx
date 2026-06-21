import { type PropsWithChildren, type ReactElement, useMemo } from "react";
import { buildChecksStateValue } from "../app-state-context-values";
import {
  ChecksOperationsContext,
  type ChecksOperationsContextValue,
  ChecksStateContext,
  useActiveWorkspaceContext,
  useRepoRuntimeHealthContext,
  useRuntimeAvailabilityContext,
} from "../app-state-contexts";
import { useChecks } from "../operations/workspace/use-checks";

type ChecksStateProviderProps = PropsWithChildren;

export function ChecksStateProvider({ children }: ChecksStateProviderProps): ReactElement {
  const { activeWorkspace } = useActiveWorkspaceContext();
  const { availableRuntimeDefinitions } = useRuntimeAvailabilityContext();
  const {
    runtimeHealthByRuntime: repoRuntimeHealthByRuntime,
    isLoadingRepoRuntimeHealth,
    refreshRepoRuntimeHealth,
  } = useRepoRuntimeHealthContext();
  const {
    runtimeCheck,
    runtimeCheckFailureKind,
    activeTaskStoreCheck,
    taskStoreCheckFailureKind,
    isLoadingChecks,
    setIsLoadingChecks,
    refreshRuntimeCheck,
    refreshTaskStoreCheckForRepo,
    refreshChecks,
    hasRuntimeCheck,
    hasCachedTaskStoreCheck,
    clearActiveTaskStoreCheck,
  } = useChecks({
    activeWorkspace,
    runtimeDefinitions: availableRuntimeDefinitions,
    runtimeHealthByRuntime: repoRuntimeHealthByRuntime,
    isLoadingRepoRuntimeHealth,
    refreshRepoRuntimeHealth,
  });

  const checksStateValue = useMemo(
    () =>
      buildChecksStateValue({
        runtimeCheck,
        taskStoreCheck: activeTaskStoreCheck,
        runtimeCheckFailureKind,
        taskStoreCheckFailureKind,
        isLoadingChecks,
        refreshChecks,
      }),
    [
      activeTaskStoreCheck,
      taskStoreCheckFailureKind,
      isLoadingChecks,
      refreshChecks,
      runtimeCheckFailureKind,
      runtimeCheck,
    ],
  );

  const checksOperationsValue = useMemo<ChecksOperationsContextValue>(
    () => ({
      refreshRuntimeCheck,
      refreshTaskStoreCheckForRepo,
      clearActiveTaskStoreCheck,
      setIsLoadingChecks,
      hasRuntimeCheck,
      hasCachedTaskStoreCheck,
    }),
    [
      clearActiveTaskStoreCheck,
      hasCachedTaskStoreCheck,
      hasRuntimeCheck,
      refreshTaskStoreCheckForRepo,
      refreshRuntimeCheck,
      setIsLoadingChecks,
    ],
  );

  return (
    <ChecksOperationsContext.Provider value={checksOperationsValue}>
      <ChecksStateContext.Provider value={checksStateValue}>{children}</ChecksStateContext.Provider>
    </ChecksOperationsContext.Provider>
  );
}
