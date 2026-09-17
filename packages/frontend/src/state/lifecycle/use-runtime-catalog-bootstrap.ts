import type { RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentRuntimeCatalog, RuntimeWorkingDirectoryRef } from "@openducktor/core";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { isRepoRuntimeReady } from "@/lib/repo-runtime-health";
import { runtimeCatalogQueryOptions } from "@/state/queries/runtime-catalog";
import type { RepoRuntimeHealthMap } from "@/types/diagnostics";
import type { ActiveWorkspace } from "@/types/state-slices";

type UseRuntimeCatalogBootstrapArgs = {
  activeWorkspace: ActiveWorkspace | null;
  enabledRuntimeDefinitions: RuntimeDescriptor[];
  runtimeHealthByRuntime: RepoRuntimeHealthMap;
  loadRepoRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>;
};

export function useRuntimeCatalogBootstrap({
  activeWorkspace,
  enabledRuntimeDefinitions,
  runtimeHealthByRuntime,
  loadRepoRuntimeCatalog,
}: UseRuntimeCatalogBootstrapArgs): void {
  const queryClient = useQueryClient();
  const repoPath = activeWorkspace?.repoPath ?? null;

  useEffect(() => {
    if (repoPath === null) {
      return;
    }
    for (const definition of enabledRuntimeDefinitions) {
      if (!isRepoRuntimeReady(runtimeHealthByRuntime[definition.kind] ?? null)) {
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
    enabledRuntimeDefinitions,
    loadRepoRuntimeCatalog,
    queryClient,
    repoPath,
    runtimeHealthByRuntime,
  ]);
}
