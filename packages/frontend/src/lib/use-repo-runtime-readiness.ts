import {
  allRepoRuntimeReadinessTarget,
  deriveRepoRuntimeReadiness,
  type RepoRuntimeReadinessSnapshot,
  type RepoRuntimeReadinessTarget,
} from "@/lib/repo-runtime-readiness";
import { useChecksStateContext, useRuntimeAvailabilityContext } from "@/state/app-state-contexts";

type UseRepoRuntimeReadinessArgs = {
  hasWorkspace: boolean;
  runtimeTarget?: RepoRuntimeReadinessTarget;
};

export type RepoRuntimeReadiness = RepoRuntimeReadinessSnapshot & {
  refreshChecks: () => Promise<void>;
};

export function useRepoRuntimeReadiness({
  hasWorkspace,
  runtimeTarget = allRepoRuntimeReadinessTarget,
}: UseRepoRuntimeReadinessArgs): RepoRuntimeReadiness {
  const { allRuntimeDefinitions, isLoadingRuntimeDefinitions, runtimeDefinitionsError } =
    useRuntimeAvailabilityContext();
  const { runtimeHealthByRuntime, isLoadingChecks, refreshChecks } = useChecksStateContext();
  const readiness = deriveRepoRuntimeReadiness({
    hasActiveWorkspace: hasWorkspace,
    runtimeDefinitions: allRuntimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
    runtimeHealthByRuntime,
    isLoadingChecks,
    runtimeTarget,
  });

  return {
    ...readiness,
    refreshChecks,
  };
}
