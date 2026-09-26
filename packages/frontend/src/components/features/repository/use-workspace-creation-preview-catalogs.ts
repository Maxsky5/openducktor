import type { AgentRuntimeCatalog, AgentRuntimePreviewModelsInput } from "@openducktor/contracts";
import { useQueries, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useMemo } from "react";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import {
  resolveRuntimeCatalogSurface,
  RUNTIME_CATALOG_GC_TIME_MS,
  RUNTIME_CATALOG_STALE_TIME_MS,
} from "@/state/queries/runtime-catalog";
import { skippedQueryOptions, SKIPPED_QUERY_KEY_SEGMENT } from "@/state/queries/skipped-query";
import type { RuntimeModelCatalogQueryResource } from "@/state/queries/use-runtime-model-catalogs";

type PreviewRuntimeKind = AgentRuntimePreviewModelsInput["runtimeKind"];

const previewQueryOptions = (
  repoPath: string,
  runtimeKind: PreviewRuntimeKind,
  loadPreviewModels: (input: AgentRuntimePreviewModelsInput) => Promise<AgentRuntimeCatalog>,
) =>
  queryOptions({
    queryKey: [
      "workspace-model-preview",
      normalizeWorkingDirectory(repoPath),
      runtimeKind,
    ] as const,
    queryFn: (): Promise<AgentRuntimeCatalog> => loadPreviewModels({ repoPath, runtimeKind }),
    staleTime: RUNTIME_CATALOG_STALE_TIME_MS,
    gcTime: RUNTIME_CATALOG_GC_TIME_MS,
    retry: false,
  });

export const useWorkspaceCreationPreviewCatalogs = ({
  repoPath,
  active,
  runtimeKinds,
  loadPreviewModels,
}: {
  repoPath: string;
  active: boolean;
  runtimeKinds: readonly PreviewRuntimeKind[];
  loadPreviewModels: (input: AgentRuntimePreviewModelsInput) => Promise<AgentRuntimeCatalog>;
}): RuntimeModelCatalogQueryResource[] => {
  const queryClient = useQueryClient();
  const kinds = useMemo(() => Array.from(new Set(runtimeKinds)), [runtimeKinds]);
  const queries = useQueries({
    queries: kinds.map((runtimeKind) =>
      repoPath
        ? { ...previewQueryOptions(repoPath, runtimeKind, loadPreviewModels), enabled: active }
        : skippedQueryOptions<AgentRuntimeCatalog>({
            queryKey: ["workspace-model-preview", SKIPPED_QUERY_KEY_SEGMENT, runtimeKind],
            staleTime: RUNTIME_CATALOG_STALE_TIME_MS,
          }),
    ),
  });

  return kinds.map((runtimeKind, index) => {
    const query = queries[index];
    if (!query) throw new Error(`Missing preview model query for '${runtimeKind}'.`);
    const surface = resolveRuntimeCatalogSurface(query.data?.models, query.error);
    return {
      runtimeKind,
      catalog: surface.catalog,
      error: surface.error,
      isFetching: query.isFetching,
      isEnabled: active && Boolean(repoPath),
      retry: async () => {
        if (!repoPath) throw new Error("Choose a repository before retrying its models.");
        const options = previewQueryOptions(repoPath, runtimeKind, loadPreviewModels);
        await queryClient.invalidateQueries({
          queryKey: options.queryKey,
          exact: true,
          refetchType: "none",
        });
        await queryClient.fetchQuery(options).catch(() => undefined);
      },
    };
  });
};
