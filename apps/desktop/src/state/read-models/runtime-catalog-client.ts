import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";

export type RuntimeCatalogClient = {
  loadRepoRuntimeCatalog: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<AgentModelCatalog>;
};

let configuredRuntimeCatalogClient: RuntimeCatalogClient | null = null;

export const configureRuntimeCatalogClient = (client: RuntimeCatalogClient): void => {
  configuredRuntimeCatalogClient = client;
};

const getConfiguredRuntimeCatalogClient = (): RuntimeCatalogClient => {
  if (!configuredRuntimeCatalogClient) {
    throw new Error(
      "Runtime catalog client is not configured. Initialize it from AppStateProvider before use.",
    );
  }
  return configuredRuntimeCatalogClient;
};

export const loadRepoRuntimeCatalog = (
  repoPath: string,
  runtimeKind: RuntimeKind,
): Promise<AgentModelCatalog> =>
  getConfiguredRuntimeCatalogClient().loadRepoRuntimeCatalog(repoPath, runtimeKind);
