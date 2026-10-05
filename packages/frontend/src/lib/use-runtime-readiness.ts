import {
  allRuntimeReadinessTarget,
  deriveRuntimeReadiness,
  type RuntimeReadinessSnapshot,
  type RuntimeReadinessTarget,
} from "@/lib/runtime-readiness";
import {
  useHostRuntimeStatusContext,
  useRuntimeAvailabilityContext,
} from "@/state/app-state-contexts";

type UseRuntimeReadinessArgs = {
  hasWorkspace: boolean;
  runtimeTarget?: RuntimeReadinessTarget;
};

export type RuntimeReadiness = RuntimeReadinessSnapshot & {
  isLoadingChecks: boolean;
  /** Reads host runtime status again. It never starts or restarts a runtime. */
  refreshChecks: () => Promise<void>;
};

export function useRuntimeReadiness({
  hasWorkspace,
  runtimeTarget = allRuntimeReadinessTarget,
}: UseRuntimeReadinessArgs): RuntimeReadiness {
  const { allRuntimeDefinitions, isLoadingRuntimeDefinitions, runtimeDefinitionsError } =
    useRuntimeAvailabilityContext();
  const runtimeStatus = useHostRuntimeStatusContext();
  const readiness = deriveRuntimeReadiness({
    hasWorkspace,
    runtimeDefinitions: allRuntimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
    runtimeStatus,
    runtimeTarget,
  });

  return {
    ...readiness,
    isLoadingChecks: runtimeStatus.isRefreshing,
    refreshChecks: runtimeStatus.refresh,
  };
}
