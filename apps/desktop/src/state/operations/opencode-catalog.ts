import { OpencodeSdkAdapter } from "@openblueprint/adapters-opencode-sdk";
import type { AgentModelCatalog } from "@openblueprint/core";
import { host } from "./host";

const adapter = new OpencodeSdkAdapter();

const toBaseUrl = (port: number): string => `http://127.0.0.1:${port}`;

export async function loadRepoOpencodeCatalog(repoPath: string): Promise<AgentModelCatalog> {
  const runtime = await host.opencodeRepoRuntimeEnsure(repoPath);
  return adapter.listAvailableModels({
    baseUrl: toBaseUrl(runtime.port),
    workingDirectory: runtime.workingDirectory,
  });
}
