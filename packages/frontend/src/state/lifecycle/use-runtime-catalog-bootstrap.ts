import type { RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentRuntimeCatalog, RuntimeWorkingDirectoryRef } from "@openducktor/core";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  readRuntimeKindReadiness,
  type RuntimeStatusReadinessInput,
} from "@/lib/runtime-readiness";
import { runtimeCatalogQueryOptions } from "@/state/queries/runtime-catalog";
import type { ActiveWorkspace } from "@/types/state-slices";

type UseRuntimeCatalogBootstrapArgs = {
  activeWorkspace: ActiveWorkspace | null;
  availableRuntimeDefinitions: RuntimeDescriptor[];
  runtimeStatus: RuntimeStatusReadinessInput;
  loadRepoRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>;
};

/** Prefetches the selected workspace catalog of each kind that is currently ready in the host. */
export function useRuntimeCatalogBootstrap({
  activeWorkspace,
  availableRuntimeDefinitions,
  runtimeStatus,
  loadRepoRuntimeCatalog,
}: UseRuntimeCatalogBootstrapArgs): void {
  const queryClient = useQueryClient();
  const repoPath = activeWorkspace?.repoPath ?? null;

  useEffect(() => {
    if (repoPath === null) {
      return;
    }
    for (const definition of availableRuntimeDefinitions) {
      if (readRuntimeKindReadiness(runtimeStatus, definition).state !== "ready") {
        continue;
      }
      void queryClient.prefetchQuery(
        runtimeCatalogQueryOptions(
          { repoPath, runtimeKind: definition.kind, workingDirectory: repoPath },
          loadRepoRuntimeCatalog,
        ),
      );
    }
  }, [availableRuntimeDefinitions, loadRepoRuntimeCatalog, queryClient, repoPath, runtimeStatus]);
}
