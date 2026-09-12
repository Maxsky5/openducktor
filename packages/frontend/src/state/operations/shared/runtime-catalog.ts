import type { HostClient } from "@openducktor/host-client";
import type { RepoRuntimeRef, RuntimeKind } from "@openducktor/contracts";
import type {
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
  hostClient: Pick<
    HostClient,
    | "agentRuntimeListModels"
    | "agentRuntimeListSlashCommands"
    | "agentRuntimeListSkills"
    | "agentRuntimeListSubagents"
    | "agentRuntimeSearchFiles"
    | "repoRuntimeHealthStatus"
  > = host,
): RuntimeCatalogOperations => ({
  loadRepoRuntimeCatalog: async (runtimeRef) => hostClient.agentRuntimeListModels(runtimeRef),
  loadRepoRuntimeSlashCommands: async (runtimeRef) =>
    hostClient.agentRuntimeListSlashCommands(runtimeRef),
  loadRepoRuntimeSkills: async (runtimeRef) => hostClient.agentRuntimeListSkills(runtimeRef),
  loadRepoRuntimeSubagents: async (runtimeRef) => hostClient.agentRuntimeListSubagents(runtimeRef),
  loadRepoRuntimeFileSearch: async (runtimeRef, query) =>
    hostClient.agentRuntimeSearchFiles({
      ...runtimeRef,
      query,
    }),
  checkRepoRuntimeHealth: async (repoPath, runtimeKind) =>
    hostClient.repoRuntimeHealthStatus(repoPath, runtimeKind),
});
