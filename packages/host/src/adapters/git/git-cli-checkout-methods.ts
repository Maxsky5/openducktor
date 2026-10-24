import { realpath } from "node:fs/promises";
import { Effect } from "effect";
import { HostOperationError, toHostOperationError } from "../../effect/host-errors";
import {
  type GitCommandRunner,
  readGitCheckout,
  requireNonEmptyEffect,
  runGit,
  runGitAllowFailure,
} from "../../infrastructure/git/git-command-runner";
import { createGitReadCapture } from "../../infrastructure/git/git-read-capture";
import { isListedWorktreePath, listWorktrees } from "../../infrastructure/git/git-worktree";
import type { GitCheckout, GitPort, GitWorktreeEntry } from "../../ports/git-port";

type CheckoutMethods = Pick<
  GitPort,
  | "canonicalizePath"
  | "isGitRepository"
  | "getRepositoryRoot"
  | "readCheckout"
  | "isRegisteredWorktree"
  | "listWorktrees"
>;

/**
 * The reads that check the directory of a Git request. Checkout and worktree list reads take
 * canonical paths, so one refresh shares them by path.
 */
export const createGitCliCheckoutMethods = (runner: GitCommandRunner) => {
  const captureCheckout = createGitReadCapture<GitCheckout | null>();
  const captureWorktrees = createGitReadCapture<GitWorktreeEntry[]>();
  const methods: CheckoutMethods = {
    canonicalizePath(inputPath) {
      return Effect.tryPromise({
        try: () => realpath(inputPath),
        catch: (cause) =>
          toHostOperationError(cause, "git.canonicalizePath", {
            path: inputPath,
          }),
      });
    },
    isGitRepository(workingDirectory) {
      return Effect.gen(function* () {
        const result = yield* runGitAllowFailure(runner, workingDirectory, [
          "rev-parse",
          "--is-inside-work-tree",
        ]);
        return result.ok && result.stdout.trim() === "true";
      });
    },
    getRepositoryRoot(workingDirectory) {
      return Effect.gen(function* () {
        const output = yield* runGit(runner, workingDirectory, ["rev-parse", "--show-toplevel"]);
        const repositoryRoot = output.replace(/\r?\n$/u, "");
        if (!repositoryRoot) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "git.rev-parse.show-toplevel",
              message: "Git returned an empty repository root.",
            }),
          );
        }
        return repositoryRoot;
      });
    },
    readCheckout(directory, readContext) {
      return captureCheckout(directory, readContext, readGitCheckout(runner, directory));
    },
    isRegisteredWorktree(repoPath, worktreePath, readContext) {
      return Effect.gen(function* () {
        const target = yield* requireNonEmptyEffect(worktreePath, "worktree path");
        const worktrees = yield* captureWorktrees(
          repoPath,
          readContext,
          listWorktrees(runner, repoPath),
        );
        return yield* isListedWorktreePath(worktrees, target);
      });
    },
    listWorktrees(repoPath) {
      return listWorktrees(runner, repoPath);
    },
  };
  return {
    methods,
    clear: () => {
      captureCheckout.clear();
      captureWorktrees.clear();
    },
  };
};
