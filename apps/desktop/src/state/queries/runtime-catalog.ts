import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { loadRepoRuntimeCatalog } from "../operations/runtime-catalog";

const RUNTIME_CATALOG_STALE_TIME_MS = 5 * 60_000;

export const runtimeCatalogQueryKeys = {
  all: ["runtime-catalog"] as const,
  repo: (repoPath: string, runtimeKind: RuntimeKind) =>
    [...runtimeCatalogQueryKeys.all, repoPath, runtimeKind] as const,
};

export const repoRuntimeCatalogQueryOptions = (repoPath: string, runtimeKind: RuntimeKind) =>
  queryOptions({
    queryKey: runtimeCatalogQueryKeys.repo(repoPath, runtimeKind),
    queryFn: (): Promise<AgentModelCatalog> => loadRepoRuntimeCatalog(repoPath, runtimeKind),
    staleTime: RUNTIME_CATALOG_STALE_TIME_MS,
  });

export const loadRepoRuntimeCatalogFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  runtimeKind: RuntimeKind,
): Promise<AgentModelCatalog> =>
  queryClient.fetchQuery(repoRuntimeCatalogQueryOptions(repoPath, runtimeKind));
