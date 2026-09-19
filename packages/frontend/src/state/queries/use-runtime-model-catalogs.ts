import type { RuntimeKind } from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentRuntimeCatalog,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  resolveRuntimeCatalogSurface,
  retryRuntimeCatalogSurface,
  runtimeCatalogQueryOptions,
  skippedRuntimeCatalogQueryOptions,
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
  loadCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>;
};

export function useRuntimeModelCatalogs({
  repoPath,
  runtimeKinds,
  enabledRuntimeKinds,
  loadCatalog,
}: UseRuntimeModelCatalogsArgs) {
  const queryClient = useQueryClient();
  const [retryingRuntimeKinds, setRetryingRuntimeKinds] = useState<ReadonlySet<RuntimeKind>>(
    () => new Set(),
  );
  const uniqueRuntimeKinds = useMemo(() => Array.from(new Set(runtimeKinds)), [runtimeKinds]);
  const enabledRuntimeKindSet = useMemo(() => new Set(enabledRuntimeKinds), [enabledRuntimeKinds]);
  const catalogQueries = useQueries({
    queries: uniqueRuntimeKinds.map((runtimeKind) => {
      const runtimeRef: RuntimeWorkingDirectoryRef | null = repoPath
        ? { repoPath, runtimeKind, workingDirectory: repoPath }
        : null;
      return {
        ...(runtimeRef
          ? runtimeCatalogQueryOptions(runtimeRef, loadCatalog)
          : skippedRuntimeCatalogQueryOptions()),
        enabled: runtimeRef !== null && enabledRuntimeKindSet.has(runtimeKind),
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
        const isRetrying = retryingRuntimeKinds.has(runtimeKind);
        const isFetching = query.isFetching || isRetrying;
        const surface = resolveRuntimeCatalogSurface(query.data?.models, query.error);
        const hasUsableCatalog = isFetching || surface.error === null;
        return {
          runtimeKind,
          catalog: hasUsableCatalog ? surface.catalog : null,
          isFetching,
          isEnabled,
          error: isFetching ? null : surface.error,
          retry: async (): Promise<void> => {
            if (repoPath === null) {
              throw new Error("A repository path is required to retry the model catalog.");
            }
            setRetryingRuntimeKinds((current) => {
              if (current.has(runtimeKind)) {
                return current;
              }
              const next = new Set(current);
              next.add(runtimeKind);
              return next;
            });
            try {
              await retryRuntimeCatalogSurface({
                queryClient,
                runtimeRef: { repoPath, runtimeKind, workingDirectory: repoPath },
                surface: "models",
                loadRuntimeCatalog: loadCatalog,
              });
            } finally {
              setRetryingRuntimeKinds((current) => {
                if (!current.has(runtimeKind)) {
                  return current;
                }
                const next = new Set(current);
                next.delete(runtimeKind);
                return next;
              });
            }
          },
        };
      }),
    [
      catalogQueries,
      enabledRuntimeKindSet,
      loadCatalog,
      queryClient,
      repoPath,
      retryingRuntimeKinds,
      uniqueRuntimeKinds,
    ],
  );

  return { resources } satisfies { resources: RuntimeModelCatalogQueryResource[] };
}
