import type { GitProviderRepository } from "@openducktor/contracts";
import { Effect } from "effect";
import type { GithubCommandResolverPort } from "../../../ports/github-cli-port";

const githubRepositorySelector = (repository: GitProviderRepository): string => {
  const host = repository.host.trim();
  return `${host}/${repository.owner.trim()}/${repository.name.trim()}`;
};

export const runGithubRepositoryCommandAllowFailure = (
  githubCommands: GithubCommandResolverPort,
  repoPath: string,
  repository: GitProviderRepository,
  args: string[],
) =>
  Effect.gen(function* () {
    const githubCommand = yield* githubCommands.resolve();
    return yield* githubCommand.githubCli.run(
      githubCommand.ghCommand,
      [...args, "--repo", githubRepositorySelector(repository)],
      { cwd: repoPath },
    );
  });
