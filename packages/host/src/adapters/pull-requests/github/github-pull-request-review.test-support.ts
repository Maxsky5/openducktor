import { Effect } from "effect";
import { createGithubCliAdapter } from "../../git-providers/github-cli";
import type { GithubCommandResolverPort } from "../../../ports/github-cli-port";
import type { SystemCommandPort } from "../../../ports/system-command-port";

const unexpectedCall = (operation: string): Effect.Effect<never, never> =>
  Effect.die(`Unexpected ${operation} call`);

export const createGithubReviewTestCommands = (
  runCommandAllowFailure: SystemCommandPort["runCommandAllowFailure"],
): GithubCommandResolverPort => {
  const systemCommands: SystemCommandPort = {
    resolveCommandPath: () => unexpectedCall("resolveCommandPath"),
    versionCommand: () => unexpectedCall("versionCommand"),
    runCommandAllowFailure,
  };
  const githubCli = createGithubCliAdapter(systemCommands);

  return {
    resolve: () => Effect.succeed({ ghCommand: "gh", githubCli }),
  };
};
