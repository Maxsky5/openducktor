import { type PropsWithChildren, type ReactElement, useMemo } from "react";
import type { RepoOpencodeHealthCheck } from "@/types/diagnostics";
import { buildChecksStateValue } from "../app-state-context-values";
import {
  ChecksOperationsContext,
  type ChecksOperationsContextValue,
  ChecksStateContext,
  useActiveRepoContext,
} from "../app-state-contexts";
import { useChecks } from "../operations";

type ChecksStateProviderProps = PropsWithChildren<{
  checkRepoOpencodeHealth: (repoPath: string) => Promise<RepoOpencodeHealthCheck>;
}>;

export function ChecksStateProvider({
  checkRepoOpencodeHealth,
  children,
}: ChecksStateProviderProps): ReactElement {
  const { activeRepo } = useActiveRepoContext();
  const {
    runtimeCheck,
    activeBeadsCheck,
    activeRepoOpencodeHealth,
    isLoadingChecks,
    setIsLoadingChecks,
    refreshRuntimeCheck,
    refreshBeadsCheckForRepo,
    refreshRepoOpencodeHealthForRepo,
    refreshChecks,
    hasRuntimeCheck,
    hasCachedBeadsCheck,
    hasCachedRepoOpencodeHealth,
    clearActiveBeadsCheck,
    clearActiveRepoOpencodeHealth,
  } = useChecks({
    activeRepo,
    checkRepoOpencodeHealth,
  });

  const checksStateValue = useMemo(
    () =>
      buildChecksStateValue({
        runtimeCheck,
        beadsCheck: activeBeadsCheck,
        opencodeHealth: activeRepoOpencodeHealth,
        isLoadingChecks,
        refreshChecks,
      }),
    [activeBeadsCheck, activeRepoOpencodeHealth, isLoadingChecks, refreshChecks, runtimeCheck],
  );

  const checksOperationsValue = useMemo<ChecksOperationsContextValue>(
    () => ({
      refreshRuntimeCheck,
      refreshBeadsCheckForRepo,
      refreshRepoOpencodeHealthForRepo,
      clearActiveBeadsCheck,
      clearActiveRepoOpencodeHealth,
      setIsLoadingChecks,
      hasRuntimeCheck,
      hasCachedBeadsCheck,
      hasCachedRepoOpencodeHealth,
    }),
    [
      clearActiveBeadsCheck,
      clearActiveRepoOpencodeHealth,
      hasCachedBeadsCheck,
      hasCachedRepoOpencodeHealth,
      hasRuntimeCheck,
      refreshBeadsCheckForRepo,
      refreshRepoOpencodeHealthForRepo,
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
