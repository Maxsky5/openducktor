import { DEFAULT_AGENT_RUNTIMES, type RuntimeKind } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { type PropsWithChildren, type ReactElement, useMemo } from "react";
import { filterEnabledRuntimeDefinitions } from "@/lib/agent-runtime";
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
import { settingsSnapshotQueryOptions } from "../queries/workspace";

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
  const { data: settingsSnapshot } = useQuery(settingsSnapshotQueryOptions());
  const enabledRuntimeDefinitions = useMemo(
    () =>
      settingsSnapshot
        ? filterEnabledRuntimeDefinitions(
            runtimeDefinitions,
            settingsSnapshot.agentRuntimes ?? DEFAULT_AGENT_RUNTIMES,
          )
        : [],
    [runtimeDefinitions, settingsSnapshot],
  );
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
    runtimeDefinitions: enabledRuntimeDefinitions,
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
