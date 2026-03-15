import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { queryOptions } from "@tanstack/react-query";

const RUNTIME_CATALOG_STALE_TIME_MS = 5 * 60_000;

const runtimeCatalogQueryKeys = {
  all: ["runtime-catalog"] as const,
  repo: (repoPath: string, runtimeKind: RuntimeKind) =>
    [...runtimeCatalogQueryKeys.all, repoPath, runtimeKind] as const,
};

export const repoRuntimeCatalogQueryOptions = (
  repoPath: string,
  runtimeKind: RuntimeKind,
  loadRepoRuntimeCatalog: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<AgentModelCatalog>,
) =>
  queryOptions({
    queryKey: runtimeCatalogQueryKeys.repo(repoPath, runtimeKind),
    queryFn: (): Promise<AgentModelCatalog> => loadRepoRuntimeCatalog(repoPath, runtimeKind),
    staleTime: RUNTIME_CATALOG_STALE_TIME_MS,
  });
