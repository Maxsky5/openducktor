import { GithubProviderAdapter } from "../../adapters/git-providers/github-provider-adapter";
import { Effect } from "effect";
import {
  createGitProviderResolver,
  type GitProviderResolver,
} from "../../application/git/git-provider-resolver";
import { createGithubCommandDependencies } from "../../application/tasks/support/github-pull-requests";
import type { GitPort } from "../../ports/git-port";
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
}): GitProviderResolver => {
  const githubDependencies = createGithubCommandDependencies({ systemCommands, toolDiscovery });
  return Effect.runSync(
    createGitProviderResolver([new GithubProviderAdapter({ githubDependencies, gitPort })]),
  );
};
