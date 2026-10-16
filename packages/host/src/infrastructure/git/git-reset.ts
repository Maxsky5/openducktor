import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import {
  combineOutput,
  type GitCommandRunner,
  requireNonEmptyEffect,
  runGit,
  runGitAllowFailure,
} from "./git-command-runner";

const gitOperationError = (message: string, operation: string): HostOperationError =>
  new HostOperationError({ message, operation });

export const restoreWorktreeToReference = (
  runner: GitCommandRunner,
  workingDirectory: string,
  reference: string,
) =>
  Effect.gen(function* () {
    const targetReference = yield* requireNonEmptyEffect(reference, "reference");
    const resolvedCommit = yield* requireNonEmptyEffect(
      (yield* runGit(runner, workingDirectory, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${targetReference}^{commit}`,
      ])).trim(),
      "resolved reference",
    );
    yield* runGit(runner, workingDirectory, ["reset", "--hard", resolvedCommit]);
    const cleanup = yield* runGitAllowFailure(runner, workingDirectory, ["clean", "-d", "-f"]);
    if (!cleanup.ok) {
      return yield* Effect.fail(
        gitOperationError(
          `Tracked content was restored to ${targetReference}, but ordinary untracked-file cleanup did not complete: ${combineOutput(cleanup.stdout, cleanup.stderr)}`,
          "git.restore-worktree.clean-untracked",
        ),
      );
    }
  });
