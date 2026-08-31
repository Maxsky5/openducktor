import { Effect } from "effect";
import { GithubProviderAdapter } from "../../adapters/git-providers/github-provider-adapter";
import {
  createGitProviderResolver,
  type GitProviderResolver,
} from "../../application/git/git-provider-resolver";
import type { GitPort } from "../../ports/git-port";
import type { GitProviderRegistrationError } from "../../ports/git-provider-errors";
import type { GithubCommandResolverPort } from "../../ports/github-cli-port";

export const createNodeGitProviderResolver = ({
  gitPort,
  githubCommands,
}: {
  gitPort: GitPort;
  githubCommands: GithubCommandResolverPort;
}): Effect.Effect<GitProviderResolver, GitProviderRegistrationError> => {
  return createGitProviderResolver([new GithubProviderAdapter({ githubCommands, gitPort })]);
};
