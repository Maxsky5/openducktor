import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import { useMemo } from "react";
import {
  deriveRepoRuntimeReadiness,
  type RepoRuntimeReadinessSnapshot,
} from "@/lib/repo-runtime-health";
import type { RepoRuntimeHealthMap } from "@/types/diagnostics";
import type { ActiveWorkspace } from "@/types/state-slices";

type UseRepoRuntimeReadinessArgs = {
  activeWorkspace: ActiveWorkspace | null;
  runtimeDefinitions: RuntimeDescriptor[];
  isLoadingRuntimeDefinitions: boolean;
  runtimeDefinitionsError: string | null;
  runtimeHealthByRuntime: RepoRuntimeHealthMap;
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
  runtimeKind?: RuntimeKind | null;
};

export type RepoRuntimeReadiness = RepoRuntimeReadinessSnapshot & {
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
  runtimeKind = null,
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
        runtimeKind,
      }),
    [
      activeWorkspace,
      isLoadingChecks,
      isLoadingRuntimeDefinitions,
      runtimeDefinitions,
      runtimeDefinitionsError,
      runtimeHealthByRuntime,
      runtimeKind,
    ],
  );

  return {
    ...readiness,
    refreshChecks,
  };
}
