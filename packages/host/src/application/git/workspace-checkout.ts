import type { GitReadContext } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { GitPort, GitPortError } from "../../ports/git-port";

export type WorkspaceCheckout =
  | "local_repo_root"
  | "local_worktree"
  | "not_git_directory"
  | "outside_workspace";

export type WorkspaceCheckoutGitPort = Pick<GitPort, "readCheckout" | "isRegisteredWorktree">;

/** Where a directory sits relative to the repository, by the root of its checkout. */
export type WorkspaceCheckoutRead =
  | { kind: "repository_missing" }
  | { kind: "not_git_directory" }
  | { kind: "repository_checkout" }
  | { kind: "worktree"; root: string }
  | { kind: "other_repository" }
  | { kind: "unlisted_worktree" };

/**
 * Classify a directory as the workspace repository root or one of its registered worktrees.
 * A registered worktree can be anywhere on disk. Both paths must be canonical.
 */
export const classifyWorkspaceCheckout = (
  git: WorkspaceCheckoutGitPort,
  input: { canonicalRepoPath: string; canonicalDirectory: string },
  readContext?: GitReadContext,
): Effect.Effect<WorkspaceCheckout, GitPortError> =>
  Effect.gen(function* () {
    const read = yield* readWorkspaceCheckout(git, input, readContext);
    switch (read.kind) {
      case "repository_missing":
        return yield* new HostValidationError({
          field: "repoPath",
          message: `Workspace repository is not a Git work tree: ${input.canonicalRepoPath}. Restore the repository before you continue.`,
        });
      case "not_git_directory":
        return "not_git_directory";
      // A directory inside a checkout is not that checkout.
      case "repository_checkout":
        return input.canonicalDirectory === input.canonicalRepoPath
          ? "local_repo_root"
          : "outside_workspace";
      case "worktree":
        return read.root === input.canonicalDirectory ? "local_worktree" : "outside_workspace";
      case "other_repository":
      case "unlisted_worktree":
        return "outside_workspace";
    }
  });

/**
 * Reads the checkout of a directory, which can be a subdirectory of the checkout. The repository
 * checkout costs one Git process. Any other directory costs two parallel checkout reads and one
 * worktree list. One read context shares those reads across the requests of one refresh.
 */
export const readWorkspaceCheckout = (
  git: WorkspaceCheckoutGitPort,
  input: { canonicalRepoPath: string; canonicalDirectory: string },
  readContext?: GitReadContext,
): Effect.Effect<WorkspaceCheckoutRead, GitPortError> =>
  Effect.gen(function* () {
    const { canonicalRepoPath, canonicalDirectory } = input;
    if (canonicalDirectory === canonicalRepoPath) {
      const checkout = yield* git.readCheckout(canonicalDirectory, readContext);
      return checkout ? { kind: "repository_checkout" } : { kind: "repository_missing" };
    }
    const [repository, directory] = yield* Effect.all(
      [
        git.readCheckout(canonicalRepoPath, readContext),
        git.readCheckout(canonicalDirectory, readContext),
      ],
      { concurrency: 2 },
    );
    if (!directory) return { kind: "not_git_directory" };
    if (!repository) return { kind: "repository_missing" };
    if (directory.root === repository.root) return { kind: "repository_checkout" };
    if (directory.commonDirectory !== repository.commonDirectory)
      return { kind: "other_repository" };
    // A shared Git directory alone also matches a worktree that Git no longer lists.
    if (!(yield* git.isRegisteredWorktree(canonicalRepoPath, directory.root, readContext)))
      return { kind: "unlisted_worktree" };
    return { kind: "worktree", root: directory.root };
  });
