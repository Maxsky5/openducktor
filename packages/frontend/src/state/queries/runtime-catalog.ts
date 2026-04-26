import type { RuntimeKind } from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentSlashCommandCatalog,
} from "@openducktor/core";
import { queryOptions } from "@tanstack/react-query";

const RUNTIME_CATALOG_STALE_TIME_MS = 5 * 60_000;
export const RUNTIME_FILE_SEARCH_STALE_TIME_MS = 15_000;

const runtimeCatalogQueryKeys = {
  all: ["runtime-catalog"] as const,
  repo: (repoPath: string, runtimeKind: RuntimeKind) =>
    [...runtimeCatalogQueryKeys.all, repoPath, runtimeKind] as const,
  repoSlashCommands: (repoPath: string, runtimeKind: RuntimeKind) =>
    [...runtimeCatalogQueryKeys.all, "slash-commands", repoPath, runtimeKind] as const,
  repoFileSearch: (repoPath: string, runtimeKind: RuntimeKind, query: string) =>
    [...runtimeCatalogQueryKeys.all, "file-search", repoPath, runtimeKind, query] as const,
};

export const repoRuntimeCatalogQueryOptions = (
  repoPath: string,
  runtimeKind: RuntimeKind | "",
  loadRepoRuntimeCatalog: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<AgentModelCatalog>,
) =>
  queryOptions({
    queryKey: runtimeCatalogQueryKeys.repo(repoPath, runtimeKind),
    queryFn: (): Promise<AgentModelCatalog> => {
      if (!runtimeKind) {
        throw new Error("Runtime kind is required to load the model catalog.");
      }
      return loadRepoRuntimeCatalog(repoPath, runtimeKind);
    },
    staleTime: RUNTIME_CATALOG_STALE_TIME_MS,
  });

export const repoRuntimeSlashCommandsQueryOptions = (
  repoPath: string,
  runtimeKind: RuntimeKind | "",
  loadRepoRuntimeSlashCommands: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<AgentSlashCommandCatalog>,
) =>
  queryOptions({
    queryKey: runtimeCatalogQueryKeys.repoSlashCommands(repoPath, runtimeKind),
    queryFn: (): Promise<AgentSlashCommandCatalog> =>
      runtimeKind
        ? loadRepoRuntimeSlashCommands(repoPath, runtimeKind)
        : Promise.reject(new Error("Runtime kind is required to load slash commands.")),
    staleTime: RUNTIME_CATALOG_STALE_TIME_MS,
  });

export const repoRuntimeFileSearchQueryOptions = (
  repoPath: string,
  runtimeKind: RuntimeKind | "",
  query: string,
  loadRepoRuntimeFileSearch: (
    repoPath: string,
    runtimeKind: RuntimeKind,
    query: string,
  ) => Promise<AgentFileSearchResult[]>,
) =>
  queryOptions({
    queryKey: runtimeCatalogQueryKeys.repoFileSearch(repoPath, runtimeKind, query),
    queryFn: (): Promise<AgentFileSearchResult[]> =>
      runtimeKind
        ? loadRepoRuntimeFileSearch(repoPath, runtimeKind, query)
        : Promise.reject(new Error("Runtime kind is required to search files.")),
    staleTime: RUNTIME_FILE_SEARCH_STALE_TIME_MS,
  });
