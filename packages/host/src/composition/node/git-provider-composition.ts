import { Effect } from "effect";
import { GithubProviderAdapter } from "../../adapters/git-providers/github-provider-adapter";
import {
  createGitProviderResolver,
  type GitProviderResolver,
} from "../../application/git/git-provider-resolver";
import { createGithubCommandDependencies } from "../../application/tasks/support/github-pull-requests";
import type { GitPort } from "../../ports/git-port";
import type { GitProviderRegistrationError } from "../../ports/git-provider-errors";
import type { GitProviderPort } from "../../ports/git-provider-port";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";

type GitProviderResolverEffect = Effect.Effect<GitProviderResolver, GitProviderRegistrationError>;

export const createNodeGitProviderResolver = (
  registrations: readonly GitProviderPort[],
): GitProviderResolverEffect => createGitProviderResolver(registrations);

export const createDefaultNodeGitProviderResolver = ({
  gitPort,
  systemCommands,
  toolDiscovery,
}: {
  gitPort: GitPort;
  systemCommands: SystemCommandPort;
  toolDiscovery: ToolDiscoveryPort;
}): GitProviderResolverEffect => {
  const githubDependencies = createGithubCommandDependencies({ systemCommands, toolDiscovery });
  return createNodeGitProviderResolver([
    new GithubProviderAdapter({ githubDependencies, gitPort }),
  ]);
};
