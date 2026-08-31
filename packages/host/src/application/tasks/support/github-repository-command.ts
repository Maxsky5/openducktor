import type { GitProviderRepository } from "@openducktor/contracts";
import { Effect } from "effect";
import type { GithubCommandDependencies } from "./github-pull-requests";

const githubRepositorySelector = (repository: GitProviderRepository): string => {
  const host = repository.host.trim();
  return `${host}/${repository.owner.trim()}/${repository.name.trim()}`;
};

export const runGithubRepositoryCommandAllowFailure = (
  dependencies: GithubCommandDependencies,
  repoPath: string,
  repository: GitProviderRepository,
  args: string[],
) =>
  Effect.gen(function* () {
    const githubCommand = yield* dependencies.resolveGithubCommand();
    return yield* githubCommand.githubCli.run(
      githubCommand.ghCommand,
      [...args, "--repo", githubRepositorySelector(repository)],
      { cwd: repoPath },
    );
  });
