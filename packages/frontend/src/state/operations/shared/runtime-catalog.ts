import type { RuntimeKind } from "@openducktor/contracts";
import type {
  AgentEnginePort,
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentSkillCatalog,
  AgentSlashCommandCatalog,
} from "@openducktor/core";
import type { RepoRuntimeHealthCheck } from "@/types/diagnostics";
import { host } from "./host";

type ListCatalogInput = {
  repoPath: string;
  runtimeKind: RuntimeKind;
};

export type RuntimeCatalogAdapter = Pick<
  AgentEnginePort,
  "listAvailableModels" | "listAvailableSlashCommands" | "listAvailableSkills" | "searchFiles"
>;

type RuntimeCatalogDependencies = {
  repoRuntimeHealthStatus: (
    runtimeKind: RuntimeKind,
    repoPath: string,
  ) => Promise<RepoRuntimeHealthCheck>;
  listAvailableModels: (input: ListCatalogInput) => Promise<AgentModelCatalog>;
  listAvailableSlashCommands: (input: ListCatalogInput) => Promise<AgentSlashCommandCatalog>;
  listAvailableSkills?: (
    input: ListCatalogInput & { workingDirectory: string },
  ) => Promise<AgentSkillCatalog>;
  searchFiles: (input: ListCatalogInput & { query: string }) => Promise<AgentFileSearchResult[]>;
};

const toRuntimeInput = (repoPath: string, runtimeKind: RuntimeKind): ListCatalogInput => ({
  repoPath,
  runtimeKind,
});

export const createRuntimeCatalogOperations = (deps: RuntimeCatalogDependencies) => {
  const loadRepoRuntimeCatalog = async (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ): Promise<AgentModelCatalog> => {
    return deps.listAvailableModels(toRuntimeInput(repoPath, runtimeKind));
  };

  const loadRepoRuntimeSlashCommands = async (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ): Promise<AgentSlashCommandCatalog> => {
    return deps.listAvailableSlashCommands(toRuntimeInput(repoPath, runtimeKind));
  };

  const loadRepoRuntimeSkills = async (
    repoPath: string,
    runtimeKind: RuntimeKind,
    workingDirectory: string,
  ): Promise<AgentSkillCatalog> => {
    if (!deps.listAvailableSkills) {
      throw new Error("Runtime skill catalog loading is unavailable.");
    }
    return deps.listAvailableSkills({
      ...toRuntimeInput(repoPath, runtimeKind),
      workingDirectory,
    });
  };

  const loadRepoRuntimeFileSearch = async (
    repoPath: string,
    runtimeKind: RuntimeKind,
    query: string,
  ): Promise<AgentFileSearchResult[]> => {
    return deps.searchFiles({
      ...toRuntimeInput(repoPath, runtimeKind),
      query,
    });
  };

  const checkRepoRuntimeHealth = async (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ): Promise<RepoRuntimeHealthCheck> => {
    return deps.repoRuntimeHealthStatus(runtimeKind, repoPath);
  };

  return {
    loadRepoRuntimeCatalog,
    loadRepoRuntimeSlashCommands,
    loadRepoRuntimeSkills,
    loadRepoRuntimeFileSearch,
    checkRepoRuntimeHealth,
  };
};

type RuntimeCatalogOperations = ReturnType<typeof createRuntimeCatalogOperations>;

export const createHostRuntimeCatalogOperations = (
  getAdapter: (runtimeKind: RuntimeKind) => RuntimeCatalogAdapter,
): RuntimeCatalogOperations =>
  createRuntimeCatalogOperations({
    repoRuntimeHealthStatus: (runtimeKind, repoPath) =>
      host.repoRuntimeHealthStatus(repoPath, runtimeKind),
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
    listAvailableSkills: (input) =>
      getAdapter(input.runtimeKind).listAvailableSkills({
        repoPath: input.repoPath,
        runtimeKind: input.runtimeKind,
        workingDirectory: input.workingDirectory,
      }),
    searchFiles: (input) =>
      getAdapter(input.runtimeKind).searchFiles({
        repoPath: input.repoPath,
        runtimeKind: input.runtimeKind,
        workingDirectory: input.repoPath,
        query: input.query,
      }),
  });
