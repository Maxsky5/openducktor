import type { RepoRuntimeRef, RuntimeKind } from "@openducktor/contracts";
import type {
  AgentCatalogPort,
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentSkillCatalog,
  AgentSlashCommandCatalog,
  AgentSubagentCatalog,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import type { RepoRuntimeHealthCheck } from "@/types/diagnostics";
import { host } from "./host";

export type RuntimeCatalogOperations = {
  loadRepoRuntimeCatalog(runtimeRef: RepoRuntimeRef): Promise<AgentModelCatalog>;
  loadRepoRuntimeSlashCommands(
    runtimeRef: RuntimeWorkingDirectoryRef,
  ): Promise<AgentSlashCommandCatalog>;
  loadRepoRuntimeSkills(runtimeRef: RuntimeWorkingDirectoryRef): Promise<AgentSkillCatalog>;
  loadRepoRuntimeSubagents(runtimeRef: RuntimeWorkingDirectoryRef): Promise<AgentSubagentCatalog>;
  loadRepoRuntimeFileSearch(
    runtimeRef: RuntimeWorkingDirectoryRef,
    query: string,
  ): Promise<AgentFileSearchResult[]>;
  checkRepoRuntimeHealth(
    repoPath: string,
    runtimeKind: RuntimeKind,
  ): Promise<RepoRuntimeHealthCheck>;
};

export const createHostRuntimeCatalogOperations = (
  getAdapter: (runtimeKind: RuntimeKind) => AgentCatalogPort,
): RuntimeCatalogOperations => ({
  loadRepoRuntimeCatalog: async (runtimeRef) =>
    getAdapter(runtimeRef.runtimeKind).listAvailableModels(runtimeRef),
  loadRepoRuntimeSlashCommands: async (runtimeRef) =>
    getAdapter(runtimeRef.runtimeKind).listAvailableSlashCommands(runtimeRef),
  loadRepoRuntimeSkills: async (runtimeRef) =>
    getAdapter(runtimeRef.runtimeKind).listAvailableSkills(runtimeRef),
  loadRepoRuntimeSubagents: async (runtimeRef) =>
    getAdapter(runtimeRef.runtimeKind).listAvailableSubagents(runtimeRef),
  loadRepoRuntimeFileSearch: async (runtimeRef, query) =>
    getAdapter(runtimeRef.runtimeKind).searchFiles({
      ...runtimeRef,
      query,
    }),
  checkRepoRuntimeHealth: async (repoPath, runtimeKind) =>
    host.repoRuntimeHealthStatus(repoPath, runtimeKind),
});
