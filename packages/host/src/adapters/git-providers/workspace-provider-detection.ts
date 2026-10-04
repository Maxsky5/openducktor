import {
  gitProviderConfigSchema,
  gitRepositoryKey,
  parseGitRepositoryUrl,
  type WorkspaceProviderSetupDetection,
} from "@openducktor/contracts";
import { azureDevOpsRepositoryKey } from "@openducktor/core";
import type { GitRemoteEndpoint } from "../../ports/git-port";
import { parseAzureDevOpsRepositoryUrl } from "./azure-devops/repository-identity";

export const detectWorkspaceProviders = (
  endpoints: GitRemoteEndpoint[],
): WorkspaceProviderSetupDetection => {
  const candidates = new Map<string, WorkspaceProviderSetupDetection["candidates"][number]>();
  for (const endpoint of endpoints) {
    for (const url of [...endpoint.fetchUrls, ...endpoint.pushUrls]) {
      const azure = parseAzureDevOpsRepositoryUrl(url);
      const github = parseGitRepositoryUrl(url);
      const repository = azure ?? (github?.host.toLowerCase() === "github.com" ? github : null);
      if (!repository) continue;
      const parsed = gitProviderConfigSchema.safeParse({
        id: azure ? "azure_devops" : "github",
        enabled: true,
        autoDetected: true,
        repository,
      });
      if (!parsed.success) continue;
      const key = azure
        ? `azure_devops:${azureDevOpsRepositoryKey(azure)}`
        : `github:${gitRepositoryKey(github!)}`;
      const candidate = candidates.get(key);
      if (candidate) {
        if (!candidate.remoteNames.includes(endpoint.name))
          candidate.remoteNames.push(endpoint.name);
      } else candidates.set(key, { config: parsed.data, remoteNames: [endpoint.name] });
    }
  }
  let outcome: WorkspaceProviderSetupDetection["outcome"] = "ambiguous";
  if (candidates.size === 0) outcome = "none";
  else if (candidates.size === 1) outcome = "detected";
  return {
    outcome,
    candidates: [...candidates.values()],
  };
};
