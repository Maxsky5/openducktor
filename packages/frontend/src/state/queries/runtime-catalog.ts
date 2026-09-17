import type { RepoRuntimeRef } from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentRuntimeCatalog,
  AgentRuntimeCatalogSurface,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import { type QueryKey, type QueryClient, queryOptions } from "@tanstack/react-query";
import { errorMessage } from "@/lib/errors";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import { SKIPPED_QUERY_KEY_SEGMENT, skippedQueryOptions } from "./skipped-query";

export const RUNTIME_CATALOG_STALE_TIME_MS = 5 * 60_000;
export const RUNTIME_FILE_SEARCH_STALE_TIME_MS = 15_000;

export const runtimeCatalogQueryKeys = {
  all: ["runtime-catalog"] as const,
  catalog: ({ repoPath, runtimeKind, workingDirectory }: RuntimeWorkingDirectoryRef) =>
    [
      ...runtimeCatalogQueryKeys.all,
      "catalog",
      normalizeWorkingDirectory(repoPath),
      runtimeKind,
      normalizeWorkingDirectory(workingDirectory),
    ] as const,
  repoCatalogScope: (repoPath: string) =>
    [...runtimeCatalogQueryKeys.all, "catalog", normalizeWorkingDirectory(repoPath)] as const,
  catalogScope: ({
    repoPath,
    runtimeKind,
    workingDirectory,
  }: RepoRuntimeRef & {
    workingDirectory?: string;
  }) =>
    [
      ...runtimeCatalogQueryKeys.repoCatalogScope(repoPath),
      runtimeKind,
      ...(workingDirectory !== undefined ? [normalizeWorkingDirectory(workingDirectory)] : []),
    ] as const,
  repoFileSearch: (
    { repoPath, runtimeKind, workingDirectory }: RuntimeWorkingDirectoryRef,
    query: string,
  ) =>
    [
      ...runtimeCatalogQueryKeys.all,
      "file-search",
      normalizeWorkingDirectory(repoPath),
      runtimeKind,
      normalizeWorkingDirectory(workingDirectory),
      query,
    ] as const,
};

export const runtimeCatalogQueryOptions = (
  runtimeRef: RuntimeWorkingDirectoryRef,
  loadRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>,
) =>
  queryOptions<AgentRuntimeCatalog, Error, AgentRuntimeCatalog, QueryKey>({
    queryKey: runtimeCatalogQueryKeys.catalog(runtimeRef),
    queryFn: (): Promise<AgentRuntimeCatalog> => loadRuntimeCatalog(runtimeRef),
    staleTime: RUNTIME_CATALOG_STALE_TIME_MS,
    retry: false,
  });

export const skippedRuntimeCatalogQueryOptions = () =>
  skippedQueryOptions<AgentRuntimeCatalog>({
    queryKey: [...runtimeCatalogQueryKeys.all, SKIPPED_QUERY_KEY_SEGMENT, "catalog"],
    staleTime: RUNTIME_CATALOG_STALE_TIME_MS,
  });

export const loadRuntimeCatalogFromQuery = (
  queryClient: QueryClient,
  runtimeRef: RuntimeWorkingDirectoryRef,
  loadRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>,
): Promise<AgentRuntimeCatalog> =>
  queryClient.fetchQuery(runtimeCatalogQueryOptions(runtimeRef, loadRuntimeCatalog));

export type ResolvedRuntimeCatalogSurface<Catalog> = {
  catalog: Catalog | null;
  error: string | null;
};

export const resolveRuntimeCatalogSurface = <Catalog>(
  surface: AgentRuntimeCatalogSurface<Catalog> | undefined,
  cause: unknown,
): ResolvedRuntimeCatalogSurface<Catalog> => {
  if (surface?.status === "available") {
    return {
      catalog: surface.catalog,
      error: cause !== null && cause !== undefined ? errorMessage(cause) : null,
    };
  }
  if (surface?.status === "failed") {
    return { catalog: null, error: surface.message };
  }
  if (cause !== null && cause !== undefined) {
    return { catalog: null, error: errorMessage(cause) };
  }
  return { catalog: null, error: null };
};

export const repoRuntimeFileSearchQueryOptions = (
  runtimeRef: RuntimeWorkingDirectoryRef,
  query: string,
  loadRepoRuntimeFileSearch: (
    runtimeRef: RuntimeWorkingDirectoryRef,
    query: string,
  ) => Promise<AgentFileSearchResult[]>,
) =>
  queryOptions<AgentFileSearchResult[], Error, AgentFileSearchResult[], QueryKey>({
    queryKey: runtimeCatalogQueryKeys.repoFileSearch(runtimeRef, query),
    queryFn: (): Promise<AgentFileSearchResult[]> => loadRepoRuntimeFileSearch(runtimeRef, query),
    staleTime: RUNTIME_FILE_SEARCH_STALE_TIME_MS,
  });
