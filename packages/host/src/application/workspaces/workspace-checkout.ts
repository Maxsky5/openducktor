import { Effect } from "effect";
import type { GitPort, GitPortError } from "../../ports/git-port";

export type WorkspaceCheckout =
  | "local_repo_root"
  | "local_worktree"
  | "not_git_directory"
  | "outside_workspace";

export type WorkspaceCheckoutGitPort = Pick<
  GitPort,
  "isGitRepository" | "shareGitCommonDirectory" | "isRegisteredWorktree"
>;

/**
 * Classify a directory as the workspace repository root or one of its registered worktrees.
 * A registered worktree can be anywhere on disk. Both paths must be canonical.
 */
export const classifyWorkspaceCheckout = (
  git: WorkspaceCheckoutGitPort,
  input: { canonicalRepoPath: string; canonicalDirectory: string },
): Effect.Effect<WorkspaceCheckout, GitPortError> =>
  Effect.gen(function* () {
    const { canonicalRepoPath, canonicalDirectory } = input;
    if (!(yield* git.isGitRepository(canonicalDirectory))) return "not_git_directory";
    if (canonicalDirectory === canonicalRepoPath) return "local_repo_root";
    if (
      (yield* git.shareGitCommonDirectory(canonicalRepoPath, canonicalDirectory)) &&
      (yield* git.isRegisteredWorktree(canonicalRepoPath, canonicalDirectory))
    ) {
      return "local_worktree";
    }
    return "outside_workspace";
  });
