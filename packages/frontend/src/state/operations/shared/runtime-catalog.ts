import type { RuntimeInstanceSummary, RuntimeKind } from "@openducktor/contracts";
import type {
  AgentEnginePort,
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentSlashCommandCatalog,
} from "@openducktor/core";
import { appQueryClient } from "@/lib/query-client";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import { ensureRuntimeListFromQuery } from "@/state/queries/runtime";
import type { RepoRuntimeHealthCheck } from "@/types/diagnostics";
import { host } from "./host";

type ListCatalogInput = {
  repoPath: string;
  runtimeKind: RuntimeKind;
};

export type RuntimeCatalogAdapter = Pick<
  AgentEnginePort,
  "listAvailableModels" | "listAvailableSlashCommands" | "searchFiles"
>;

type RuntimeCatalogDependencies = {
  repoRuntimeHealth: (
    runtimeKind: RuntimeKind,
    repoPath: string,
  ) => Promise<RepoRuntimeHealthCheck>;
  listRuntimesForRepo: (
    runtimeKind: RuntimeKind,
    repoPath: string,
  ) => Promise<RuntimeInstanceSummary[]>;
  listAvailableModels: (input: ListCatalogInput) => Promise<AgentModelCatalog>;
  listAvailableSlashCommands: (input: ListCatalogInput) => Promise<AgentSlashCommandCatalog>;
  searchFiles: (input: ListCatalogInput & { query: string }) => Promise<AgentFileSearchResult[]>;
};

const toRuntimeInput = (repoPath: string, runtimeKind: RuntimeKind): ListCatalogInput => ({
  repoPath,
  runtimeKind,
});

const selectCatalogRuntime = (
  runtimes: RuntimeInstanceSummary[],
  repoPath: string,
  runtimeKind: RuntimeKind,
): RuntimeInstanceSummary | null => {
  const normalizedRepoPath = normalizeWorkingDirectory(repoPath);
  return (
    runtimes.find(
      (runtime) =>
        runtime.kind === runtimeKind &&
        normalizeWorkingDirectory(runtime.repoPath) === normalizedRepoPath,
    ) ?? null
  );
};

export const createRuntimeCatalogOperations = (deps: RuntimeCatalogDependencies) => {
  const resolveCatalogInput = async (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ): Promise<ListCatalogInput> => {
    const existingRuntime = selectCatalogRuntime(
      await deps.listRuntimesForRepo(runtimeKind, repoPath),
      repoPath,
      runtimeKind,
    );
    if (!existingRuntime) {
      throw new Error(
        `No live repo runtime found for repo '${repoPath}' and runtime '${runtimeKind}'.`,
      );
    }
    return toRuntimeInput(repoPath, runtimeKind);
  };

  const loadRepoRuntimeCatalog = async (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ): Promise<AgentModelCatalog> => {
    return deps.listAvailableModels(await resolveCatalogInput(repoPath, runtimeKind));
  };

  const loadRepoRuntimeSlashCommands = async (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ): Promise<AgentSlashCommandCatalog> => {
    return deps.listAvailableSlashCommands(await resolveCatalogInput(repoPath, runtimeKind));
  };

  const loadRepoRuntimeFileSearch = async (
    repoPath: string,
    runtimeKind: RuntimeKind,
    query: string,
  ): Promise<AgentFileSearchResult[]> => {
    return deps.searchFiles({
      ...(await resolveCatalogInput(repoPath, runtimeKind)),
      query,
    });
  };

  const checkRepoRuntimeHealth = async (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ): Promise<RepoRuntimeHealthCheck> => {
    return deps.repoRuntimeHealth(runtimeKind, repoPath);
  };

  return {
    loadRepoRuntimeCatalog,
    loadRepoRuntimeSlashCommands,
    loadRepoRuntimeFileSearch,
    checkRepoRuntimeHealth,
  };
};

type RuntimeCatalogOperations = ReturnType<typeof createRuntimeCatalogOperations>;

export const createHostRuntimeCatalogOperations = (
  getAdapter: (runtimeKind: RuntimeKind) => RuntimeCatalogAdapter,
): RuntimeCatalogOperations =>
  createRuntimeCatalogOperations({
    repoRuntimeHealth: (runtimeKind, repoPath) => host.repoRuntimeHealth(repoPath, runtimeKind),
    listRuntimesForRepo: (runtimeKind, repoPath) =>
      ensureRuntimeListFromQuery(appQueryClient, runtimeKind, repoPath),
    listAvailableModels: (input) =>
      getAdapter(input.runtimeKind).listAvailableModels({
        repoPath: input.repoPath,
        runtimeKind: input.runtimeKind,
      }),
    listAvailableSlashCommands: (input) =>
      getAdapter(input.runtimeKind).listAvailableSlashCommands({
        repoPath: input.repoPath,
        runtimeKind: input.runtimeKind,
      }),
    searchFiles: (input) =>
      getAdapter(input.runtimeKind).searchFiles({
        repoPath: input.repoPath,
        runtimeKind: input.runtimeKind,
        workingDirectory: input.repoPath,
        query: input.query,
      }),
  });
