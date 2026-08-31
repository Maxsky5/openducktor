import { Effect } from "effect";
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
  const githubDependencies = createGithubCommandDependencies({ systemCommands, toolDiscovery });
  return createGitProviderResolver([new GithubProviderAdapter({ githubDependencies, gitPort })]);
};
