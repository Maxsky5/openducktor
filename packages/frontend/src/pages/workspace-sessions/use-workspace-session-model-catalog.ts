import type { RuntimeWorkingDirectoryRef } from "@openducktor/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { RuntimeReadinessState } from "@/lib/runtime-readiness";
import { useRuntimeAvailabilityContext } from "@/state/app-state-contexts";
import {
  resolveRuntimeCatalogSurface,
  retryRuntimeCatalog,
  runtimeCatalogQueryOptions,
} from "@/state/queries/runtime-catalog";

export function useWorkspaceSessionModelCatalog(
  runtimeRef: RuntimeWorkingDirectoryRef,
  readiness: RuntimeReadinessState,
) {
  const { loadRepoRuntimeCatalog } = useRuntimeAvailabilityContext();
  const queryClient = useQueryClient();
  const query = useQuery({
    ...runtimeCatalogQueryOptions(runtimeRef, loadRepoRuntimeCatalog),
    enabled: readiness === "ready",
  });
  const surface = resolveRuntimeCatalogSurface(query.data?.models, query.error);
  const retry = useCallback(
    () =>
      retryRuntimeCatalog({
        queryClient,
        runtimeRef,
        loadRuntimeCatalog: loadRepoRuntimeCatalog,
      }),
    [queryClient, loadRepoRuntimeCatalog, runtimeRef],
  );

  return { ...surface, isLoading: query.isFetching, retry };
}
