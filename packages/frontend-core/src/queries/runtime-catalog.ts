import type { RepoRuntimeRef, RuntimeKind } from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentRuntimeCatalog,
  AgentRuntimeCatalogSurface,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import { type QueryKey, type QueryClient, queryOptions } from "@tanstack/react-query";
import { errorMessage } from "../lib/errors";
import { normalizeWorkingDirectory } from "../lib/working-directory";
import { SKIPPED_QUERY_KEY_SEGMENT, skippedQueryOptions } from "./skipped-query";

export const RUNTIME_CATALOG_STALE_TIME_MS = 30 * 60_000;
export const RUNTIME_CATALOG_GC_TIME_MS = 60 * 60_000;
export const RUNTIME_FILE_SEARCH_STALE_TIME_MS = 15_000;

const runtimeCatalogKey = ["runtime-catalog"] as const;

export const runtimeCatalogQueryKeys = {
  all: runtimeCatalogKey,
  skipped: [...runtimeCatalogKey, SKIPPED_QUERY_KEY_SEGMENT] as const,
  // Exact key for one runtime working directory read.
  catalog: ({ repoPath, runtimeKind, workingDirectory }: RuntimeWorkingDirectoryRef) =>
    [
      ...runtimeCatalogQueryKeys.all,
      "catalog",
      normalizeWorkingDirectory(repoPath),
      runtimeKind,
      normalizeWorkingDirectory(workingDirectory),
    ] as const,
  /** True for a catalog key of this runtime kind in any workspace or directory. */
  matchesCatalogRuntimeKind: (key: QueryKey, runtimeKind: RuntimeKind): boolean =>
    key[0] === runtimeCatalogKey[0] && key[1] === "catalog" && key[3] === runtimeKind,
  repoCatalogScope: (repoPath: string) =>
    [...runtimeCatalogQueryKeys.all, "catalog", normalizeWorkingDirectory(repoPath)] as const,
  // Prefix key for invalidation. Omit workingDirectory to cover all directories.
  runtimeCatalogScope: ({
    repoPath,
    runtimeKind,
    workingDirectory,
  }: RepoRuntimeRef & {
    workingDirectory?: string | undefined;
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

/** After a failed model read, the cache keeps the last models it had. */
export type CachedModelSurface =
  | { status: "available"; catalog: AgentModelCatalog }
  | { status: "failed"; message: string; lastCatalog?: AgentModelCatalog };

export type CachedRuntimeCatalog = Omit<AgentRuntimeCatalog, "models"> & {
  models?: CachedModelSurface | undefined;
};

/** Options of every catalog read, live or preview. */
export const catalogQueryOptions = (
  queryKey: QueryKey,
  loadCatalog: () => Promise<AgentRuntimeCatalog>,
) =>
  queryOptions<CachedRuntimeCatalog, Error, CachedRuntimeCatalog, QueryKey>({
    queryKey,
    queryFn: async ({ client }): Promise<CachedRuntimeCatalog> =>
      withLastModels(client.getQueryData<CachedRuntimeCatalog>(queryKey), await loadCatalog()),
    staleTime: RUNTIME_CATALOG_STALE_TIME_MS,
    gcTime: RUNTIME_CATALOG_GC_TIME_MS,
    retry: false,
  });

export const runtimeCatalogQueryOptions = (
  runtimeRef: RuntimeWorkingDirectoryRef,
  loadRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>,
) =>
  catalogQueryOptions(runtimeCatalogQueryKeys.catalog(runtimeRef), () =>
    loadRuntimeCatalog(runtimeRef),
  );

export const skippedRuntimeCatalogQueryOptions = () =>
  skippedQueryOptions<CachedRuntimeCatalog>({
    queryKey: runtimeCatalogQueryKeys.skipped,
    staleTime: RUNTIME_CATALOG_STALE_TIME_MS,
  });

export const loadRuntimeCatalogFromQuery = (
  queryClient: QueryClient,
  runtimeRef: RuntimeWorkingDirectoryRef,
  loadRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>,
): Promise<CachedRuntimeCatalog> =>
  queryClient.fetchQuery(runtimeCatalogQueryOptions(runtimeRef, loadRuntimeCatalog));

/**
 * Marks the entry stale first: fetchQuery skips the network for a fresh entry.
 * A failed read lands in the query error path.
 */
export const retryCatalogRead = async (
  queryClient: QueryClient,
  options: ReturnType<typeof catalogQueryOptions>,
): Promise<void> => {
  await queryClient.invalidateQueries({
    queryKey: options.queryKey,
    exact: true,
    refetchType: "none",
  });
  await queryClient.fetchQuery(options).catch(() => undefined);
};

export type RetryRuntimeCatalogArgs = {
  queryClient: QueryClient;
  runtimeRef: RuntimeWorkingDirectoryRef;
  loadRuntimeCatalog: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>;
};

export const retryRuntimeCatalog = ({
  queryClient,
  runtimeRef,
  loadRuntimeCatalog,
}: RetryRuntimeCatalogArgs): Promise<void> =>
  retryCatalogRead(queryClient, runtimeCatalogQueryOptions(runtimeRef, loadRuntimeCatalog));

export type ResolvedRuntimeCatalogSurface<Catalog> = {
  catalog: Catalog | null;
  error: string | null;
};

/**
 * A query error hides retained data, even while a retry runs. Without a query
 * error, a failed surface reports its own message.
 */
export const resolveRuntimeCatalogSurface = <Catalog>(
  surface: AgentRuntimeCatalogSurface<Catalog> | undefined,
  queryError?: Error | null,
): ResolvedRuntimeCatalogSurface<Catalog> => {
  if (queryError !== null && queryError !== undefined) {
    return { catalog: null, error: errorMessage(queryError) };
  }
  if (surface?.status === "available") {
    return { catalog: surface.catalog, error: null };
  }
  if (surface?.status === "failed") {
    return { catalog: null, error: surface.message };
  }
  return { catalog: null, error: null };
};

/** A failed refresh, rejected or with failed models, keeps the last models next to its error. */
export const resolveRuntimeModelCatalogSurface = (
  surface: CachedModelSurface | undefined,
  queryError: Error | null,
): ResolvedRuntimeCatalogSurface<AgentModelCatalog> => {
  const catalog = lastModelCatalog(surface);
  if (queryError !== null) {
    return { catalog, error: errorMessage(queryError) };
  }
  return { catalog, error: surface?.status === "failed" ? surface.message : null };
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

/**
 * A read that returns failed models keeps the models of the previous read, so a view never hides
 * loaded models. The other surfaces take the new read as it is.
 */
const withLastModels = (
  previous: CachedRuntimeCatalog | undefined,
  read: AgentRuntimeCatalog,
): CachedRuntimeCatalog => {
  const lastCatalog = lastModelCatalog(previous?.models);
  if (read.models?.status !== "failed" || lastCatalog === null) {
    return read;
  }
  return { ...read, models: { ...read.models, lastCatalog } };
};

const lastModelCatalog = (models: CachedModelSurface | undefined): AgentModelCatalog | null => {
  if (models?.status === "available") {
    return models.catalog;
  }
  return models?.lastCatalog ?? null;
};
