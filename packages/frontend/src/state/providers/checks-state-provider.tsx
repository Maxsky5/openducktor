import type { RuntimeKind } from "@openducktor/contracts";
import { type PropsWithChildren, type ReactElement, useMemo } from "react";
import type { RepoRuntimeHealthCheck } from "@/types/diagnostics";
import { buildChecksStateValue } from "../app-state-context-values";
import {
  ChecksOperationsContext,
  type ChecksOperationsContextValue,
  ChecksStateContext,
  useActiveWorkspaceContext,
  useRuntimeDefinitionsContext,
} from "../app-state-contexts";
import { useChecks } from "../operations";

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
  const { runtimeDefinitions } = useRuntimeDefinitionsContext();
  const {
    runtimeCheck,
    runtimeCheckFailureKind,
    activeBeadsCheck,
    beadsCheckFailureKind,
    activeRepoRuntimeHealthByRuntime,
    isLoadingChecks,
    setIsLoadingChecks,
    refreshRuntimeCheck,
    refreshBeadsCheckForRepo,
    refreshRepoRuntimeHealthForRepo,
    refreshChecks,
    hasRuntimeCheck,
    hasCachedBeadsCheck,
    hasCachedRepoRuntimeHealth,
    clearActiveBeadsCheck,
    clearActiveRepoRuntimeHealth,
  } = useChecks({
    activeWorkspace,
    runtimeDefinitions,
    checkRepoRuntimeHealth,
  });

  const checksStateValue = useMemo(
    () =>
      buildChecksStateValue({
        runtimeCheck,
        beadsCheck: activeBeadsCheck,
        runtimeCheckFailureKind,
        beadsCheckFailureKind,
        runtimeHealthByRuntime: activeRepoRuntimeHealthByRuntime,
        isLoadingChecks,
        refreshChecks,
      }),
    [
      activeBeadsCheck,
      beadsCheckFailureKind,
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
      refreshBeadsCheckForRepo,
      refreshRepoRuntimeHealthForRepo,
      clearActiveBeadsCheck,
      clearActiveRepoRuntimeHealth,
      setIsLoadingChecks,
      hasRuntimeCheck,
      hasCachedBeadsCheck,
      hasCachedRepoRuntimeHealth,
    }),
    [
      clearActiveBeadsCheck,
      clearActiveRepoRuntimeHealth,
      hasCachedBeadsCheck,
      hasCachedRepoRuntimeHealth,
      hasRuntimeCheck,
      refreshBeadsCheckForRepo,
      refreshRepoRuntimeHealthForRepo,
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
