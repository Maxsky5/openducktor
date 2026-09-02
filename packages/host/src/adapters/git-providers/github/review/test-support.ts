import { Effect } from "effect";
import type { SystemCommandPort } from "../../../../ports/system-command-port";
import type { GithubCli } from "../cli";

const unexpectedCall = (operation: string): Effect.Effect<never, never> =>
  Effect.die(`Unexpected ${operation} call`);

export const createGithubReviewTestCli = (
  runCommandAllowFailure: SystemCommandPort["runCommandAllowFailure"],
): GithubCli => ({
  resolve: () =>
    Effect.succeed({
      executablePath: "gh",
      getAuth: () => unexpectedCall("getAuth"),
      readVersion: () => unexpectedCall("readVersion"),
      run: (args, options) => runCommandAllowFailure("gh", args, options),
    }),
});
