import type { RuntimeKind } from "@openducktor/contracts";
import { useCallback } from "react";
import {
  allRepoRuntimeReadinessTarget,
  deriveRepoRuntimeReadiness,
  deriveSnapshotReadableRepoRuntimeKinds,
  type RepoRuntimeReadinessSnapshot,
  type RepoRuntimeReadinessTarget,
} from "@/lib/repo-runtime-readiness";
import {
  useRepoRuntimeHealthContext,
  useRuntimeAvailabilityContext,
} from "@/state/app-state-contexts";

type UseRepoRuntimeReadinessArgs = {
  hasWorkspace: boolean;
  runtimeTarget?: RepoRuntimeReadinessTarget;
};

type UseSnapshotReadableRepoRuntimeKindsArgs = {
  hasWorkspace: boolean;
  runtimeKinds: readonly RuntimeKind[];
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
  const { runtimeHealthByRuntime, isLoadingRepoRuntimeHealth, refreshRepoRuntimeHealth } =
    useRepoRuntimeHealthContext();
  const refreshChecks = useCallback(async (): Promise<void> => {
    await refreshRepoRuntimeHealth();
  }, [refreshRepoRuntimeHealth]);
  const readiness = deriveRepoRuntimeReadiness({
    hasActiveWorkspace: hasWorkspace,
    runtimeDefinitions: allRuntimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
    runtimeHealthByRuntime,
    isLoadingChecks: isLoadingRepoRuntimeHealth,
    runtimeTarget,
  });

  return {
    ...readiness,
    refreshChecks,
  };
}

export function useSnapshotReadableRepoRuntimeKinds({
  hasWorkspace,
  runtimeKinds,
}: UseSnapshotReadableRepoRuntimeKindsArgs): RuntimeKind[] {
  const { allRuntimeDefinitions } = useRuntimeAvailabilityContext();
  const { runtimeHealthByRuntime } = useRepoRuntimeHealthContext();

  return deriveSnapshotReadableRepoRuntimeKinds({
    hasActiveWorkspace: hasWorkspace,
    runtimeDefinitions: allRuntimeDefinitions,
    runtimeHealthByRuntime,
    runtimeKinds,
  });
}
