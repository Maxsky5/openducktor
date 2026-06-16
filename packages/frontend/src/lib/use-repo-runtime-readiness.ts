import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import { useMemo } from "react";
import {
  deriveRepoRuntimeReadiness,
  type RepoRuntimeReadinessSnapshot,
} from "@/lib/repo-runtime-health";
import type { RepoRuntimeHealthMap } from "@/types/diagnostics";

type UseRepoRuntimeReadinessArgs = {
  hasWorkspace: boolean;
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
  hasWorkspace,
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
        hasActiveWorkspace: hasWorkspace,
        runtimeDefinitions,
        isLoadingRuntimeDefinitions,
        runtimeDefinitionsError,
        runtimeHealthByRuntime,
        isLoadingChecks,
        runtimeKind,
      }),
    [
      hasWorkspace,
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
