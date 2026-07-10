import type { RepoRuntimeRef, RuntimeKind } from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentSkillCatalog,
  AgentSlashCommandCatalog,
  AgentSubagentCatalog,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import { type QueryKey, queryOptions } from "@tanstack/react-query";
import { normalizeWorkingDirectory } from "@/lib/working-directory";

export const RUNTIME_CATALOG_STALE_TIME_MS = 5 * 60_000;
export const RUNTIME_FILE_SEARCH_STALE_TIME_MS = 15_000;

export const runtimeCatalogQueryKeys = {
  all: ["runtime-catalog"] as const,
  repo: (repoPath: string, runtimeKind: RuntimeKind) =>
    [...runtimeCatalogQueryKeys.all, repoPath, runtimeKind] as const,
  repoSessionStart: (repoPath: string, runtimeKind: RuntimeKind) =>
    [
      ...runtimeCatalogQueryKeys.all,
      "session-start",
      normalizeWorkingDirectory(repoPath),
      runtimeKind,
    ] as const,
  repoSlashCommands: ({ repoPath, runtimeKind, workingDirectory }: RuntimeWorkingDirectoryRef) =>
    [
      ...runtimeCatalogQueryKeys.all,
      "slash-commands",
      normalizeWorkingDirectory(repoPath),
      runtimeKind,
      normalizeWorkingDirectory(workingDirectory),
    ] as const,
  repoSkillsScope: ({
    repoPath,
    runtimeKind,
    workingDirectory,
  }: RepoRuntimeRef & { workingDirectory?: string }) =>
    [
      ...runtimeCatalogQueryKeys.all,
      "skills",
      normalizeWorkingDirectory(repoPath),
      runtimeKind,
      ...(workingDirectory !== undefined ? [normalizeWorkingDirectory(workingDirectory)] : []),
    ] as const,
  repoSkills: (runtimeRef: RuntimeWorkingDirectoryRef) =>
    runtimeCatalogQueryKeys.repoSkillsScope(runtimeRef),
  repoSubagents: ({ repoPath, runtimeKind, workingDirectory }: RuntimeWorkingDirectoryRef) =>
    [
      ...runtimeCatalogQueryKeys.all,
      "subagents",
      normalizeWorkingDirectory(repoPath),
      runtimeKind,
      normalizeWorkingDirectory(workingDirectory),
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

export const repoRuntimeCatalogQueryOptions = (
  runtimeRef: RepoRuntimeRef,
  loadRepoRuntimeCatalog: (runtimeRef: RepoRuntimeRef) => Promise<AgentModelCatalog>,
) =>
  queryOptions<AgentModelCatalog, Error, AgentModelCatalog, QueryKey>({
    queryKey: runtimeCatalogQueryKeys.repo(runtimeRef.repoPath, runtimeRef.runtimeKind),
    queryFn: (): Promise<AgentModelCatalog> =>
      loadRepoRuntimeCatalog({
        repoPath: runtimeRef.repoPath,
        runtimeKind: runtimeRef.runtimeKind,
      }),
    staleTime: RUNTIME_CATALOG_STALE_TIME_MS,
  });

export const sessionStartRuntimeCatalogQueryOptions = (
  runtimeRef: RepoRuntimeRef,
  loadRepoRuntimeCatalog: (runtimeRef: RepoRuntimeRef) => Promise<AgentModelCatalog>,
) =>
  queryOptions<AgentModelCatalog, Error, AgentModelCatalog, QueryKey>({
    queryKey: runtimeCatalogQueryKeys.repoSessionStart(runtimeRef.repoPath, runtimeRef.runtimeKind),
    queryFn: (): Promise<AgentModelCatalog> =>
      loadRepoRuntimeCatalog({
        repoPath: runtimeRef.repoPath,
        runtimeKind: runtimeRef.runtimeKind,
      }),
    gcTime: 0,
    staleTime: 0,
  });

export const repoRuntimeSlashCommandsQueryOptions = (
  runtimeRef: RuntimeWorkingDirectoryRef,
  loadRepoRuntimeSlashCommands: (
    runtimeRef: RuntimeWorkingDirectoryRef,
  ) => Promise<AgentSlashCommandCatalog>,
) =>
  queryOptions<AgentSlashCommandCatalog, Error, AgentSlashCommandCatalog, QueryKey>({
    queryKey: runtimeCatalogQueryKeys.repoSlashCommands(runtimeRef),
    queryFn: (): Promise<AgentSlashCommandCatalog> => loadRepoRuntimeSlashCommands(runtimeRef),
    staleTime: RUNTIME_CATALOG_STALE_TIME_MS,
  });

export const repoRuntimeSkillsQueryOptions = (
  runtimeRef: RuntimeWorkingDirectoryRef,
  loadRepoRuntimeSkills: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentSkillCatalog>,
) =>
  queryOptions<AgentSkillCatalog, Error, AgentSkillCatalog, QueryKey>({
    queryKey: runtimeCatalogQueryKeys.repoSkills(runtimeRef),
    queryFn: (): Promise<AgentSkillCatalog> => loadRepoRuntimeSkills(runtimeRef),
    staleTime: RUNTIME_CATALOG_STALE_TIME_MS,
  });

export const repoRuntimeSubagentsQueryOptions = (
  runtimeRef: RuntimeWorkingDirectoryRef,
  loadRepoRuntimeSubagents: (
    runtimeRef: RuntimeWorkingDirectoryRef,
  ) => Promise<AgentSubagentCatalog>,
) =>
  queryOptions<AgentSubagentCatalog, Error, AgentSubagentCatalog, QueryKey>({
    queryKey: runtimeCatalogQueryKeys.repoSubagents(runtimeRef),
    queryFn: (): Promise<AgentSubagentCatalog> => loadRepoRuntimeSubagents(runtimeRef),
    staleTime: RUNTIME_CATALOG_STALE_TIME_MS,
  });

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
