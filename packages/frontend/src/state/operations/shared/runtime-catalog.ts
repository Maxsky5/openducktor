import type { HostClient } from "@openducktor/host-client";
import type { RuntimeKind } from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentRuntimeCatalog,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import type { RepoRuntimeHealthCheck } from "@/types/diagnostics";
import { host } from "./host";

export type RuntimeCatalogOperations = {
  loadRuntimeCatalog(runtimeRef: RuntimeWorkingDirectoryRef): Promise<AgentRuntimeCatalog>;
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
    "agentRuntimeLoadCatalog" | "agentRuntimeSearchFiles" | "repoRuntimeHealthStatus"
  > = host,
): RuntimeCatalogOperations => ({
  loadRuntimeCatalog: async (runtimeRef) => hostClient.agentRuntimeLoadCatalog(runtimeRef),
  loadRepoRuntimeFileSearch: async (runtimeRef, query) =>
    hostClient.agentRuntimeSearchFiles({
      ...runtimeRef,
      query,
    }),
  checkRepoRuntimeHealth: async (repoPath, runtimeKind) =>
    hostClient.repoRuntimeHealthStatus(repoPath, runtimeKind),
});
