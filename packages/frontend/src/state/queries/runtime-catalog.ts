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
  skipped: ["runtime-catalog", SKIPPED_QUERY_KEY_SEGMENT] as const,
  // Exact key for one runtime working directory read.
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
  // Prefix key for invalidation. Omit workingDirectory to cover all directories.
  runtimeCatalogScope: ({
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
    queryKey: runtimeCatalogQueryKeys.skipped,
    staleTime: RUNTIME_CATALOG_STALE_TIME_MS,
  });

export const loadRuntimeCatalogFromQuery = (
  queryClient: QueryClient,
  runtimeRef: RuntimeWorkingDirectoryRef,
  loadRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>,
): Promise<AgentRuntimeCatalog> =>
  queryClient.fetchQuery(runtimeCatalogQueryOptions(runtimeRef, loadRuntimeCatalog));

/**
 * The next consumer action fetches the combined catalog when the cached entry is
 * stale. A fresh entry is reused without a request.
 */
export const refreshRuntimeCatalogIfStale = (
  queryClient: QueryClient,
  runtimeRef: RuntimeWorkingDirectoryRef,
  loadRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>,
): void => {
  void queryClient
    .fetchQuery(runtimeCatalogQueryOptions(runtimeRef, loadRuntimeCatalog))
    .catch(() => undefined);
};

export type RetryRuntimeCatalogArgs = {
  queryClient: QueryClient;
  runtimeRef: RuntimeWorkingDirectoryRef;
  loadRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>;
};

/**
 * A failed-surface retry forces a combined catalog read for the runtime and
 * working directory. The request keeps the complete-catalog contract, so the
 * response replaces every surface and cannot mix data from two runtime
 * instances or revive an invalidated entry. A whole-request failure stays in
 * the query error path.
 */
export const retryRuntimeCatalog = async ({
  queryClient,
  runtimeRef,
  loadRuntimeCatalog,
}: RetryRuntimeCatalogArgs): Promise<void> => {
  const queryOptions = runtimeCatalogQueryOptions(runtimeRef, loadRuntimeCatalog);
  await queryClient.invalidateQueries({
    queryKey: queryOptions.queryKey,
    exact: true,
    refetchType: "none",
  });
  await queryClient.fetchQuery(queryOptions).catch(() => undefined);
};

export type ResolvedRuntimeCatalogSurface<Catalog> = {
  catalog: Catalog | null;
  error: string | null;
};

export type RuntimeCatalogQueryState = {
  error: unknown;
  isFetching: boolean;
};

/**
 * Projects one catalog surface for a consumer. TanStack Query keeps the last
 * data and error after a failed refetch, so a settled whole-request failure
 * discards every retained surface and reports the query error. Retained data
 * stays visible only while a refresh is in flight.
 */
export const resolveRuntimeCatalogSurface = <Catalog>(
  surface: AgentRuntimeCatalogSurface<Catalog> | undefined,
  queryState: RuntimeCatalogQueryState,
): ResolvedRuntimeCatalogSurface<Catalog> => {
  const hasQueryError = queryState.error !== null && queryState.error !== undefined;
  if (hasQueryError && !queryState.isFetching) {
    return { catalog: null, error: errorMessage(queryState.error) };
  }
  if (surface?.status === "available") {
    return { catalog: surface.catalog, error: null };
  }
  if (surface?.status === "failed") {
    return { catalog: null, error: surface.message };
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
