import type { RepoRuntimeRef, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { errorMessage } from "@/lib/errors";
import {
  RUNTIME_CATALOG_STALE_TIME_MS,
  repoRuntimeCatalogQueryOptions,
  runtimeCatalogQueryKeys,
} from "./runtime-catalog";
import { skippedQueryOptions } from "./skipped-query";

export type RuntimeModelCatalogResource = {
  runtimeKind: RuntimeKind;
  catalog: AgentModelCatalog | null;
  isLoading: boolean;
  error: string | null;
  retry: () => Promise<void>;
};

type UseRuntimeModelCatalogsArgs = {
  repoPath: string | null;
  runtimeKinds: readonly RuntimeKind[];
  enabledRuntimeKinds: readonly RuntimeKind[];
  loadCatalog: (runtimeRef: RepoRuntimeRef) => Promise<AgentModelCatalog>;
};

const skippedRuntimeCatalogQueryOptions = (runtimeRef: RepoRuntimeRef | null) =>
  skippedQueryOptions<AgentModelCatalog>({
    queryKey: runtimeRef
      ? runtimeCatalogQueryKeys.repo(runtimeRef.repoPath, runtimeRef.runtimeKind)
      : runtimeCatalogQueryKeys.all,
    staleTime: RUNTIME_CATALOG_STALE_TIME_MS,
  });

export function useRuntimeModelCatalogs({
  repoPath,
  runtimeKinds,
  enabledRuntimeKinds,
  loadCatalog,
}: UseRuntimeModelCatalogsArgs): { resources: RuntimeModelCatalogResource[] } {
  const uniqueRuntimeKinds = useMemo(() => Array.from(new Set(runtimeKinds)), [runtimeKinds]);
  const enabledRuntimeKindSet = useMemo(() => new Set(enabledRuntimeKinds), [enabledRuntimeKinds]);
  const catalogQueries = useQueries({
    queries: uniqueRuntimeKinds.map((runtimeKind) => {
      const runtimeRef = repoPath ? { repoPath, runtimeKind } : null;
      return runtimeRef && enabledRuntimeKindSet.has(runtimeKind)
        ? repoRuntimeCatalogQueryOptions(runtimeRef, loadCatalog)
        : skippedRuntimeCatalogQueryOptions(runtimeRef);
    }),
  });

  const resources = useMemo<RuntimeModelCatalogResource[]>(
    () =>
      uniqueRuntimeKinds.map((runtimeKind, index) => {
        const query = catalogQueries[index];
        if (!query) {
          throw new Error(`Missing model catalog query for runtime '${runtimeKind}'.`);
        }
        const error = query.error ? errorMessage(query.error) : null;
        return {
          runtimeKind,
          catalog: error ? null : (query.data ?? null),
          isLoading: query.isLoading,
          error,
          retry: async (): Promise<void> => {
            await query.refetch();
          },
        };
      }),
    [catalogQueries, uniqueRuntimeKinds],
  );

  return { resources };
}
