import type { RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentRuntimeCatalog, RuntimeWorkingDirectoryRef } from "@openducktor/core";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { runtimeCatalogQueryOptions } from "@/state/queries/runtime-catalog";
import type { ActiveWorkspace, HostRuntimeStatusContextValue } from "@/types/state-slices";

type UseRuntimeCatalogBootstrapArgs = {
  activeWorkspace: ActiveWorkspace | null;
  availableRuntimeDefinitions: RuntimeDescriptor[];
  runtimeStatus: Pick<HostRuntimeStatusContextValue, "statusByKind" | "isCurrent">;
  loadRepoRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>;
};

/** Prefetches the selected workspace catalog of each kind that is currently ready in the host. */
export function useRuntimeCatalogBootstrap({
  activeWorkspace,
  availableRuntimeDefinitions,
  runtimeStatus: { statusByKind, isCurrent },
  loadRepoRuntimeCatalog,
}: UseRuntimeCatalogBootstrapArgs): void {
  const queryClient = useQueryClient();
  const repoPath = activeWorkspace?.repoPath ?? null;

  useEffect(() => {
    if (repoPath === null || !isCurrent) {
      return;
    }
    for (const definition of availableRuntimeDefinitions) {
      if (statusByKind[definition.kind]?.state !== "ready") {
        continue;
      }
      void queryClient.prefetchQuery(
        runtimeCatalogQueryOptions(
          { repoPath, runtimeKind: definition.kind, workingDirectory: repoPath },
          loadRepoRuntimeCatalog,
        ),
      );
    }
  }, [
    availableRuntimeDefinitions,
    isCurrent,
    loadRepoRuntimeCatalog,
    queryClient,
    repoPath,
    statusByKind,
  ]);
}
