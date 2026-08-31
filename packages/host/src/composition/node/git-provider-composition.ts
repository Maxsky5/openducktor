import { Effect } from "effect";
import { createGithubCliAdapter } from "../../adapters/git-providers/github-cli";
import { GithubProviderAdapter } from "../../adapters/git-providers/github-provider-adapter";
import {
  createGitProviderResolver,
  type GitProviderResolver,
} from "../../application/git/git-provider-resolver";
import { createGithubCommandDependencies } from "../../application/tasks/support/github-pull-requests";
import type { GitPort } from "../../ports/git-port";
import type { GitProviderRegistrationError } from "../../ports/git-provider-errors";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";

export const createNodeGitProviderResolver = ({
  gitPort,
  systemCommands,
  toolDiscovery,
}: {
  gitPort: GitPort;
  systemCommands: SystemCommandPort;
  toolDiscovery: ToolDiscoveryPort;
}): Effect.Effect<GitProviderResolver, GitProviderRegistrationError> => {
  const githubCli = createGithubCliAdapter(systemCommands);
  const githubDependencies = createGithubCommandDependencies({
    githubCli,
    systemCommands,
    toolDiscovery,
  });
  return createGitProviderResolver([new GithubProviderAdapter({ githubDependencies, gitPort })]);
};
