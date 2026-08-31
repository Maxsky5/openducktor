import { GithubProviderAdapter } from "../../adapters/git-providers/github-provider-adapter";
import { createGitProviderResolver } from "../../application/git/git-provider-resolver";
import { createGithubCommandDependencies } from "../../application/tasks/support/github-pull-requests";
import type { GitPort } from "../../ports/git-port";
import type { GitProviderPort } from "../../ports/git-provider-port";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";

export const createNodeGitProviderResolver = (registrations: readonly GitProviderPort[]) =>
  createGitProviderResolver(registrations);

export const createDefaultNodeGitProviderResolver = (input: {
  gitPort: GitPort;
  systemCommands: SystemCommandPort;
  toolDiscovery: ToolDiscoveryPort;
}) => {
  const githubDependencies = createGithubCommandDependencies({
    systemCommands: input.systemCommands,
    toolDiscovery: input.toolDiscovery,
  });
  return createNodeGitProviderResolver([
    new GithubProviderAdapter({ githubDependencies, gitPort: input.gitPort }),
  ]);
};
