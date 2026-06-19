import type { RuntimeKind } from "@openducktor/contracts";
import { type PropsWithChildren, type ReactElement, useMemo } from "react";
import type { RepoRuntimeHealthCheck } from "@/types/diagnostics";
import {
  RepoRuntimeHealthContext,
  useActiveWorkspaceContext,
  useRuntimeAvailabilityContext,
} from "../app-state-contexts";
import { useRepoRuntimeHealth } from "../operations/workspace/use-repo-runtime-health";
import { buildRepoRuntimeHealthByRuntime } from "./repo-runtime-health-state";

type RepoRuntimeHealthProviderProps = PropsWithChildren<{
  checkRepoRuntimeHealth: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<RepoRuntimeHealthCheck>;
}>;

export function RepoRuntimeHealthProvider({
  checkRepoRuntimeHealth,
  children,
}: RepoRuntimeHealthProviderProps): ReactElement {
  const { activeWorkspace } = useActiveWorkspaceContext();
  const {
    allRuntimeDefinitions,
    availableRuntimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
  } = useRuntimeAvailabilityContext();
  const {
    activeRepoRuntimeHealthByRuntime: checkedRuntimeHealthByRuntime,
    isLoadingRepoRuntimeHealth,
    refreshRepoRuntimeHealth,
  } = useRepoRuntimeHealth({
    activeWorkspace,
    runtimeDefinitions: availableRuntimeDefinitions,
    checkRepoRuntimeHealth,
  });
  const runtimeHealthByRuntime = useMemo(
    () =>
      buildRepoRuntimeHealthByRuntime({
        checkedRuntimeHealthByRuntime,
        allRuntimeDefinitions,
        availableRuntimeDefinitions,
        isLoadingRuntimeDefinitions,
        runtimeDefinitionsError,
      }),
    [
      checkedRuntimeHealthByRuntime,
      allRuntimeDefinitions,
      availableRuntimeDefinitions,
      isLoadingRuntimeDefinitions,
      runtimeDefinitionsError,
    ],
  );

  const value = useMemo(
    () => ({
      runtimeHealthByRuntime,
      isLoadingRepoRuntimeHealth,
      refreshRepoRuntimeHealth,
    }),
    [runtimeHealthByRuntime, isLoadingRepoRuntimeHealth, refreshRepoRuntimeHealth],
  );

  return (
    <RepoRuntimeHealthContext.Provider value={value}>{children}</RepoRuntimeHealthContext.Provider>
  );
}
