import type { AgentRuntimeCatalogSurfaceName, RepoRuntimeRef } from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentRuntimeCatalog,
  AgentRuntimeCatalogSurface,
  ListAgentRuntimeCatalogInput,
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

export type RetryRuntimeCatalogSurfaceArgs = {
  queryClient: QueryClient;
  runtimeRef: RuntimeWorkingDirectoryRef;
  surface: AgentRuntimeCatalogSurfaceName;
  loadRuntimeCatalog: (input: ListAgentRuntimeCatalogInput) => Promise<AgentRuntimeCatalog>;
};

/**
 * A failed-surface retry reads only the failed surface and merges it into the
 * cached combined entry. Surfaces that succeeded keep their cached data and are
 * not re-read. When no combined entry exists yet, there is nothing to preserve,
 * so the retry reads the combined catalog.
 */
export const retryRuntimeCatalogSurface = async ({
  queryClient,
  runtimeRef,
  surface,
  loadRuntimeCatalog,
}: RetryRuntimeCatalogSurfaceArgs): Promise<void> => {
  const queryKey = runtimeCatalogQueryKeys.catalog(runtimeRef);
  const previous = queryClient.getQueryData<AgentRuntimeCatalog>(queryKey);
  try {
    const read = await loadRuntimeCatalog(
      previous === undefined ? runtimeRef : { ...runtimeRef, surfaces: [surface] },
    );
    queryClient.setQueryData<AgentRuntimeCatalog>(queryKey, (current) =>
      previous === undefined ? read : mergeCatalogSurface(current ?? {}, surface, read),
    );
  } catch (cause) {
    queryClient.setQueryData<AgentRuntimeCatalog>(queryKey, (current) =>
      current === undefined
        ? undefined
        : mergeCatalogSurface(current, surface, {
            [surface]: { status: "failed", message: errorMessage(cause) },
          }),
    );
  }
};

const mergeCatalogSurface = (
  catalog: AgentRuntimeCatalog,
  surface: AgentRuntimeCatalogSurfaceName,
  read: AgentRuntimeCatalog,
): AgentRuntimeCatalog => {
  const merged = read.runtime === undefined ? catalog : { ...catalog, runtime: read.runtime };
  switch (surface) {
    case "models":
      return read.models === undefined ? merged : { ...merged, models: read.models };
    case "slashCommands":
      return read.slashCommands === undefined
        ? merged
        : { ...merged, slashCommands: read.slashCommands };
    case "skills":
      return read.skills === undefined ? merged : { ...merged, skills: read.skills };
    case "subagents":
      return read.subagents === undefined ? merged : { ...merged, subagents: read.subagents };
  }
};

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
