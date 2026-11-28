import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import {
  combineOutput,
  type GitCommandRunner,
  requireNonEmptyEffect,
  runGit,
  runGitAllowFailure,
} from "./git-command-runner";
import { parsePorcelainEntries } from "./git-status";

const gitOperationError = (message: string, operation: string): HostOperationError =>
  new HostOperationError({ message, operation });

const readRestoreStatus = (runner: GitCommandRunner, workingDirectory: string) =>
  runGit(runner, workingDirectory, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignore-submodules=all",
  ]).pipe(Effect.map(parsePorcelainEntries));

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
    const head = yield* runGit(runner, workingDirectory, ["rev-parse", "--verify", "HEAD"]);
    const before = yield* readRestoreStatus(runner, workingDirectory);
    const restored = head.trim() !== resolvedCommit || before.some((entry) => entry.index !== "?");
    yield* runGit(runner, workingDirectory, ["reset", "--hard", resolvedCommit]);
    const cleanup = yield* runGitAllowFailure(runner, workingDirectory, ["clean", "-d", "-f"]);
    if (!cleanup.ok) {
      return yield* Effect.fail(
        gitOperationError(
          `${restored ? `Restored tracked content to ${targetReference}. ` : ""}Could not finish removing untracked files: ${combineOutput(cleanup.stdout, cleanup.stderr)}`,
          "git.restore-worktree.clean-untracked",
        ),
      );
    }
    if (restored || before.length === 0) return restored;
    const remaining = new Set(
      (yield* readRestoreStatus(runner, workingDirectory)).map(({ path }) => path),
    );
    return before.some(({ path }) => !remaining.has(path));
  });
