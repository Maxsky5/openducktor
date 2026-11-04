import {
  gitProviderConfigSchema,
  gitRepositoryKey,
  parseGitRepositoryUrl,
  type WorkspaceProviderSetupDetection,
} from "@openducktor/contracts";
import {
  azureDevOpsRepositoryKey,
  gitlabRepositoryFromRemote,
  gitlabRepositoryKey,
  isGitlabHost,
  parseGitlabRemoteUrl,
} from "@openducktor/core";
import type { GitRemoteEndpoint } from "../../ports/git-port";
import { parseAzureDevOpsRepositoryUrl } from "./azure-devops/repository-identity";
import { gitlabOriginRepository } from "./gitlab/repository";

/** Reads the providers of the remotes without a network request. */
export const detectWorkspaceProviders = (
  endpoints: GitRemoteEndpoint[],
  knownGitlabInstances: readonly string[] = [],
): WorkspaceProviderSetupDetection => {
  const candidates = new Map<string, WorkspaceProviderSetupDetection["candidates"][number]>();
  for (const endpoint of endpoints) {
    for (const url of [...endpoint.fetchUrls, ...endpoint.pushUrls]) {
      const detected = detectRepository(url, knownGitlabInstances);
      if (!detected) continue;
      const parsed = gitProviderConfigSchema.safeParse({
        id: detected.providerId,
        enabled: true,
        autoDetected: true,
        repository: detected.repository,
      });
      if (!parsed.success) continue;
      const key = `${detected.providerId}:${detected.key}`;
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
    gitlabOrigin: gitlabOriginRepository(endpoints, knownGitlabInstances),
  };
};

const detectRepository = (url: string, knownGitlabInstances: readonly string[]) => {
  const azure = parseAzureDevOpsRepositoryUrl(url);
  if (azure)
    return { providerId: "azure_devops", repository: azure, key: azureDevOpsRepositoryKey(azure) };
  const gitlabRemote = parseGitlabRemoteUrl(url);
  if (gitlabRemote && isGitlabHost(gitlabRemote.hostname, knownGitlabInstances)) {
    const gitlab = gitlabRepositoryFromRemote(gitlabRemote, knownGitlabInstances);
    if (gitlab)
      return { providerId: "gitlab", repository: gitlab, key: gitlabRepositoryKey(gitlab) };
  }
  const github = parseGitRepositoryUrl(url);
  if (github?.host.toLowerCase() === "github.com")
    return { providerId: "github", repository: github, key: gitRepositoryKey(github) };
  return null;
};
