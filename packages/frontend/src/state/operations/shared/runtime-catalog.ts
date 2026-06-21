import type { RepoRuntimeRef, RuntimeKind } from "@openducktor/contracts";
import type {
  AgentCatalogPort,
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentSkillCatalog,
  AgentSlashCommandCatalog,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import type { RepoRuntimeHealthCheck } from "@/types/diagnostics";
import { host } from "./host";

export type RuntimeCatalogOperations = {
  loadRepoRuntimeCatalog(runtimeRef: RepoRuntimeRef): Promise<AgentModelCatalog>;
  loadRepoRuntimeSlashCommands(runtimeRef: RepoRuntimeRef): Promise<AgentSlashCommandCatalog>;
  loadRepoRuntimeSkills(runtimeRef: RuntimeWorkingDirectoryRef): Promise<AgentSkillCatalog>;
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
  loadRepoRuntimeFileSearch: async (runtimeRef, query) =>
    getAdapter(runtimeRef.runtimeKind).searchFiles({
      ...runtimeRef,
      query,
    }),
  checkRepoRuntimeHealth: async (repoPath, runtimeKind) =>
    host.repoRuntimeHealthStatus(repoPath, runtimeKind),
});
