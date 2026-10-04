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
    hostMcpBridgeCheck,
    checksRepoPath,
    taskStoreCheck,
    workspaceRuntimeMcpCheck,
    isRefreshingChecks,
    refreshRuntimeCheck,
    refreshTaskStoreCheckForRepo,
    refreshChecks,
    hasRuntimeCheck,
    hasCachedTaskStoreCheck,
    clearActiveTaskStoreCheck,
  } = useChecks({
    activeWorkspace,
    runtimeDefinitions: availableRuntimeDefinitions,
    refreshHostRuntimeStatus,
  });

  const checksStateValue = useMemo(
    () =>
      buildChecksStateValue({
        runtimeCheck,
        hostMcpBridgeCheck,
        checksRepoPath,
        taskStoreCheck,
        workspaceRuntimeMcpCheck,
        isRefreshingChecks,
        refreshChecks,
      }),
    [
      checksRepoPath,
      hostMcpBridgeCheck,
      isRefreshingChecks,
      refreshChecks,
      runtimeCheck,
      taskStoreCheck,
      workspaceRuntimeMcpCheck,
    ],
  );

  const checksOperationsValue = useMemo<ChecksOperationsContextValue>(
    () => ({
      refreshRuntimeCheck,
      refreshTaskStoreCheckForRepo,
      clearActiveTaskStoreCheck,
      hasRuntimeCheck,
      hasCachedTaskStoreCheck,
    }),
    [
      clearActiveTaskStoreCheck,
      hasCachedTaskStoreCheck,
      hasRuntimeCheck,
      refreshTaskStoreCheckForRepo,
      refreshRuntimeCheck,
    ],
  );

  return (
    <ChecksOperationsContext.Provider value={checksOperationsValue}>
      <ChecksStateContext.Provider value={checksStateValue}>{children}</ChecksStateContext.Provider>
    </ChecksOperationsContext.Provider>
  );
}
