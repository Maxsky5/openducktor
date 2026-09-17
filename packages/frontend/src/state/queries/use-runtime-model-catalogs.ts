import type { RepoRuntimeRef, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { errorMessage } from "@/lib/errors";
import {
  repoRuntimeCatalogQueryOptions,
  skippedRepoRuntimeCatalogQueryOptions,
} from "./runtime-catalog";

export type RuntimeModelCatalogQueryResource = {
  runtimeKind: RuntimeKind;
  catalog: AgentModelCatalog | null;
  isFetching: boolean;
  isEnabled: boolean;
  error: string | null;
  retry: () => Promise<void>;
};

type UseRuntimeModelCatalogsArgs = {
  repoPath: string | null;
  runtimeKinds: readonly RuntimeKind[];
  enabledRuntimeKinds: readonly RuntimeKind[];
  loadCatalog: (runtimeRef: RepoRuntimeRef) => Promise<AgentModelCatalog>;
};

export function useRuntimeModelCatalogs({
  repoPath,
  runtimeKinds,
  enabledRuntimeKinds,
  loadCatalog,
}: UseRuntimeModelCatalogsArgs) {
  const uniqueRuntimeKinds = useMemo(() => Array.from(new Set(runtimeKinds)), [runtimeKinds]);
  const enabledRuntimeKindSet = useMemo(() => new Set(enabledRuntimeKinds), [enabledRuntimeKinds]);
  const catalogQueries = useQueries({
    queries: uniqueRuntimeKinds.map((runtimeKind) => {
      const runtimeRef = repoPath ? { repoPath, runtimeKind } : null;
      const isEnabled = repoPath !== null && enabledRuntimeKindSet.has(runtimeKind);
      return {
        ...(runtimeRef
          ? repoRuntimeCatalogQueryOptions(runtimeRef, loadCatalog)
          : skippedRepoRuntimeCatalogQueryOptions()),
        enabled: isEnabled,
      };
    }),
  });

  const resources = useMemo<RuntimeModelCatalogQueryResource[]>(
    () =>
      uniqueRuntimeKinds.map((runtimeKind, index) => {
        const query = catalogQueries[index];
        if (!query) {
          throw new Error(`Missing model catalog query for runtime '${runtimeKind}'.`);
        }
        const isEnabled = repoPath !== null && enabledRuntimeKindSet.has(runtimeKind);
        const error = !query.isFetching && query.error ? errorMessage(query.error) : null;
        return {
          runtimeKind,
          catalog: error ? null : (query.data ?? null),
          isFetching: query.isFetching,
          isEnabled,
          error,
          retry: async (): Promise<void> => {
            await query.refetch();
          },
        };
      }),
    [catalogQueries, enabledRuntimeKindSet, repoPath, uniqueRuntimeKinds],
  );

  return { resources } satisfies { resources: RuntimeModelCatalogQueryResource[] };
}
