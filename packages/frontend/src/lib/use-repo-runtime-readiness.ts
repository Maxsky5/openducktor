import type { RuntimeDescriptor } from "@openducktor/contracts";
import {
  allRepoRuntimeReadinessTarget,
  deriveRepoRuntimeReadiness,
  type RepoRuntimeReadinessSnapshot,
  type RepoRuntimeReadinessTarget,
} from "@/lib/repo-runtime-readiness";
import type { RepoRuntimeHealthMap } from "@/types/diagnostics";

type UseRepoRuntimeReadinessArgs = {
  hasWorkspace: boolean;
  runtimeDefinitions: RuntimeDescriptor[];
  isLoadingRuntimeDefinitions: boolean;
  runtimeDefinitionsError: string | null;
  runtimeHealthByRuntime: RepoRuntimeHealthMap;
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
  runtimeTarget?: RepoRuntimeReadinessTarget;
};

export type RepoRuntimeReadiness = RepoRuntimeReadinessSnapshot & {
  refreshChecks: () => Promise<void>;
};

export function useRepoRuntimeReadiness({
  hasWorkspace,
  runtimeDefinitions,
  isLoadingRuntimeDefinitions,
  runtimeDefinitionsError,
  runtimeHealthByRuntime,
  isLoadingChecks,
  refreshChecks,
  runtimeTarget = allRepoRuntimeReadinessTarget,
}: UseRepoRuntimeReadinessArgs): RepoRuntimeReadiness {
  const readiness = deriveRepoRuntimeReadiness({
    hasActiveWorkspace: hasWorkspace,
    runtimeDefinitions,
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
