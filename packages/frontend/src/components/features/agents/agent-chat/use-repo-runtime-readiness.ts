import { useMemo } from "react";
import { deriveRepoRuntimeReadiness } from "@/lib/repo-runtime-health";
import type { useChecksState } from "@/state";
import type { useRuntimeDefinitionsContext } from "@/state/app-state-contexts";
import type { ActiveWorkspace } from "@/types/state-slices";

type UseRepoRuntimeReadinessArgs = {
  activeWorkspace: ActiveWorkspace | null;
  runtimeDefinitions: ReturnType<typeof useRuntimeDefinitionsContext>["runtimeDefinitions"];
  isLoadingRuntimeDefinitions: ReturnType<
    typeof useRuntimeDefinitionsContext
  >["isLoadingRuntimeDefinitions"];
  runtimeDefinitionsError: ReturnType<
    typeof useRuntimeDefinitionsContext
  >["runtimeDefinitionsError"];
  runtimeHealthByRuntime: ReturnType<typeof useChecksState>["runtimeHealthByRuntime"];
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
};

export type RepoRuntimeReadiness = {
  readinessState: "ready" | "checking" | "blocked";
  isReady: boolean;
  isRuntimeStarting: boolean;
  blockedReason: string | null;
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
};

export function useRepoRuntimeReadiness({
  activeWorkspace,
  runtimeDefinitions,
  isLoadingRuntimeDefinitions,
  runtimeDefinitionsError,
  runtimeHealthByRuntime,
  isLoadingChecks,
  refreshChecks,
}: UseRepoRuntimeReadinessArgs): RepoRuntimeReadiness {
  const readiness = useMemo(
    () =>
      deriveRepoRuntimeReadiness({
        hasActiveWorkspace: activeWorkspace !== null,
        runtimeDefinitions,
        isLoadingRuntimeDefinitions,
        runtimeDefinitionsError,
        runtimeHealthByRuntime,
        isLoadingChecks,
      }),
    [
      activeWorkspace,
      isLoadingChecks,
      isLoadingRuntimeDefinitions,
      runtimeDefinitions,
      runtimeDefinitionsError,
      runtimeHealthByRuntime,
    ],
  );

  return {
    readinessState: readiness.readinessState,
    isReady: readiness.isReady,
    isRuntimeStarting: readiness.isRuntimeStarting,
    blockedReason: readiness.blockedReason,
    isLoadingChecks: readiness.isLoadingChecks,
    refreshChecks,
  };
}
