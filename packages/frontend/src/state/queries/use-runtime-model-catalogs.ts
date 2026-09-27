import type {
  AgentRuntimePreviewModelsInput,
  AgentRuntimes,
  RuntimeKind,
} from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentRuntimeCatalog,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import { type QueryKey, queryOptions, useQueries, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import {
  RUNTIME_CATALOG_GC_TIME_MS,
  RUNTIME_CATALOG_STALE_TIME_MS,
  resolveRuntimeCatalogSurface,
  runtimeCatalogQueryOptions,
  skippedRuntimeCatalogQueryOptions,
} from "./runtime-catalog";
import { skippedQueryOptions, SKIPPED_QUERY_KEY_SEGMENT } from "./skipped-query";

export type RuntimeModelCatalogQueryResource = {
  runtimeKind: RuntimeKind;
  catalog: AgentModelCatalog | null;
  isFetching: boolean;
  isEnabled: boolean;
  error: string | null;
  retry: () => Promise<void>;
};

type CatalogQueryScope = {
  repoPath: string | null;
  runtimeKinds: readonly RuntimeKind[];
  enabledRuntimeKinds: readonly RuntimeKind[];
};

type LiveCatalogSource = {
  loadRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>;
  loadPreviewModels?: never;
  agentRuntimes?: never;
};

type PreviewCatalogSource = {
  loadRuntimeCatalog?: never;
  loadPreviewModels: (input: AgentRuntimePreviewModelsInput) => Promise<AgentRuntimeCatalog>;
  agentRuntimes: AgentRuntimes;
};

type UseRuntimeModelCatalogsArgs = CatalogQueryScope & (LiveCatalogSource | PreviewCatalogSource);

const catalogQueryOptions = (
  repoPath: string,
  runtimeKind: RuntimeKind,
  source: LiveCatalogSource | PreviewCatalogSource,
) => {
  if (source.loadPreviewModels) {
    return queryOptions<AgentRuntimeCatalog, Error, AgentRuntimeCatalog, QueryKey>({
      queryKey: [
        "workspace-model-preview",
        normalizeWorkingDirectory(repoPath),
        runtimeKind,
        source.agentRuntimes[runtimeKind].executablePath,
      ] as const,
      queryFn: (): Promise<AgentRuntimeCatalog> =>
        source.loadPreviewModels({ repoPath, runtimeKind }),
      staleTime: RUNTIME_CATALOG_STALE_TIME_MS,
      gcTime: RUNTIME_CATALOG_GC_TIME_MS,
      retry: false,
    });
  }
  return runtimeCatalogQueryOptions(
    { repoPath, runtimeKind, workingDirectory: repoPath },
    source.loadRuntimeCatalog,
  );
};

const skippedCatalogQueryOptions = (
  runtimeKind: RuntimeKind,
  source: LiveCatalogSource | PreviewCatalogSource,
) => {
  if (source.loadPreviewModels) {
    return skippedQueryOptions<AgentRuntimeCatalog>({
      queryKey: ["workspace-model-preview", SKIPPED_QUERY_KEY_SEGMENT, runtimeKind],
      staleTime: RUNTIME_CATALOG_STALE_TIME_MS,
    });
  }
  return skippedRuntimeCatalogQueryOptions();
};

export function useRuntimeModelCatalogs(args: UseRuntimeModelCatalogsArgs) {
  const { repoPath, runtimeKinds, enabledRuntimeKinds } = args;
  const source = useMemo<LiveCatalogSource | PreviewCatalogSource>(() => {
    if (args.loadPreviewModels) {
      return { loadPreviewModels: args.loadPreviewModels, agentRuntimes: args.agentRuntimes };
    }
    return { loadRuntimeCatalog: args.loadRuntimeCatalog };
  }, [args.loadPreviewModels, args.agentRuntimes, args.loadRuntimeCatalog]);
  const queryClient = useQueryClient();
  const hasRepoPath = source.loadPreviewModels ? Boolean(repoPath) : repoPath !== null;
  const uniqueRuntimeKinds = useMemo(() => Array.from(new Set(runtimeKinds)), [runtimeKinds]);
  const enabledRuntimeKindSet = useMemo(() => new Set(enabledRuntimeKinds), [enabledRuntimeKinds]);
  const catalogQueries = useQueries({
    queries: uniqueRuntimeKinds.map((runtimeKind) => {
      return {
        ...(repoPath
          ? catalogQueryOptions(repoPath, runtimeKind, source)
          : skippedCatalogQueryOptions(runtimeKind, source)),
        enabled: hasRepoPath && enabledRuntimeKindSet.has(runtimeKind),
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
        const isEnabled = hasRepoPath && enabledRuntimeKindSet.has(runtimeKind);
        const surface = resolveRuntimeCatalogSurface(query.data?.models, query.error);
        return {
          runtimeKind,
          catalog: surface.catalog,
          isFetching: query.isFetching,
          isEnabled,
          error: surface.error,
          retry: async (): Promise<void> => {
            if (!repoPath && source.loadPreviewModels) {
              throw new Error("Choose a repository before retrying its models.");
            }
            if (repoPath === null) {
              throw new Error("A repository path is required to retry the model catalog.");
            }
            const options = catalogQueryOptions(repoPath, runtimeKind, source);
            await queryClient.invalidateQueries({
              queryKey: options.queryKey,
              exact: true,
              refetchType: "none",
            });
            await queryClient.fetchQuery(options).catch(() => undefined);
          },
        };
      }),
    [
      catalogQueries,
      enabledRuntimeKindSet,
      hasRepoPath,
      queryClient,
      repoPath,
      source,
      uniqueRuntimeKinds,
    ],
  );

  return { resources } satisfies { resources: RuntimeModelCatalogQueryResource[] };
}
