import type { RuntimeKind } from "@openducktor/contracts";
import { type PropsWithChildren, type ReactElement, useMemo } from "react";
import type { RepoRuntimeHealthCheck } from "@/types/diagnostics";
import { buildChecksStateValue } from "../app-state-context-values";
import {
  ChecksOperationsContext,
  type ChecksOperationsContextValue,
  ChecksStateContext,
  useActiveWorkspaceContext,
  useRuntimeAvailabilityContext,
} from "../app-state-contexts";
import { useChecks } from "../operations/workspace/use-checks";

type ChecksStateProviderProps = PropsWithChildren<{
  checkRepoRuntimeHealth: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<RepoRuntimeHealthCheck>;
}>;

export function ChecksStateProvider({
  checkRepoRuntimeHealth,
  children,
}: ChecksStateProviderProps): ReactElement {
  const { activeWorkspace } = useActiveWorkspaceContext();
  const { availableRuntimeDefinitions } = useRuntimeAvailabilityContext();
  const {
    runtimeCheck,
    runtimeCheckFailureKind,
    activeTaskStoreCheck,
    taskStoreCheckFailureKind,
    activeRepoRuntimeHealthByRuntime,
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
    checkRepoRuntimeHealth,
  });

  const checksStateValue = useMemo(
    () =>
      buildChecksStateValue({
        runtimeCheck,
        taskStoreCheck: activeTaskStoreCheck,
        runtimeCheckFailureKind,
        taskStoreCheckFailureKind,
        runtimeHealthByRuntime: activeRepoRuntimeHealthByRuntime,
        isLoadingChecks,
        refreshChecks,
      }),
    [
      activeTaskStoreCheck,
      taskStoreCheckFailureKind,
      activeRepoRuntimeHealthByRuntime,
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
