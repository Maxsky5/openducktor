import type { HostClient } from "@openducktor/host-client";
import type {
  AgentFileSearchResult,
  AgentRuntimeCatalog,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import { host } from "./host";

export type RuntimeCatalogOperations = {
  loadRuntimeCatalog(runtimeRef: RuntimeWorkingDirectoryRef): Promise<AgentRuntimeCatalog>;
  loadRepoRuntimeFileSearch(
    runtimeRef: RuntimeWorkingDirectoryRef,
    query: string,
  ): Promise<AgentFileSearchResult[]>;
};

export const createHostRuntimeCatalogOperations = (
  hostClient: Pick<HostClient, "agentRuntimeLoadCatalog" | "agentRuntimeSearchFiles"> = host,
): RuntimeCatalogOperations => ({
  loadRuntimeCatalog: async (runtimeRef) => hostClient.agentRuntimeLoadCatalog(runtimeRef),
  loadRepoRuntimeFileSearch: async (runtimeRef, query) =>
    hostClient.agentRuntimeSearchFiles({
      ...runtimeRef,
      query,
    }),
});
