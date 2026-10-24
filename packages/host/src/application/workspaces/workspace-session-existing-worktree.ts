import type {
  WorkspaceSessionExecutionTarget,
  WorkspaceSessionWorktreesListResult,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import { HostValidationError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import {
  classifyWorkspaceCheckout,
  type WorkspaceCheckoutGitPort,
} from "../git/workspace-checkout";

/**
 * Lists the registered worktrees of the repository that a new chat can use, with one Git process.
 * Ownership, local changes, and detached HEAD do not exclude a worktree.
 */
export const listWorkspaceSessionWorktrees = (
  dependencies: {
    git: Pick<GitPort, "canonicalizePath" | "listWorktrees">;
    settingsConfig: Pick<SettingsConfigPort, "pathExists">;
  },
  canonicalRepoPath: string,
) =>
  Effect.gen(function* () {
    const { git, settingsConfig } = dependencies;
    const repoKey = normalizePathForComparison(canonicalRepoPath);
    const listed = yield* Effect.forEach(
      yield* git.listWorktrees(canonicalRepoPath),
      (entry) =>
        Effect.gen(function* () {
          // Git keeps an entry for a deleted directory until it prunes the worktree.
          if (!(yield* settingsConfig.pathExists(entry.worktreePath))) return [];
          const workingDirectory = yield* git.canonicalizePath(entry.worktreePath);
          if (normalizePathForComparison(workingDirectory) === repoKey) return [];
          return [{ workingDirectory, branchName: entry.branch }];
        }),
      { concurrency: 8 },
    );
    const worktrees = listed
      .flat()
      .sort((left, right) => left.workingDirectory.localeCompare(right.workingDirectory));
    return { worktrees } satisfies WorkspaceSessionWorktreesListResult;
  });

export type ExistingWorktreeDependencies = {
  git: Pick<GitPort, "canonicalizePath" | "getCurrentBranch"> & WorkspaceCheckoutGitPort;
  settingsConfig: Pick<SettingsConfigPort, "pathExists">;
};

/**
 * Reads the selected worktree as the target of a new chat. Its current branch can differ from
 * the branch shown at selection. The caller holds the directory read guard.
 */
export const readExistingWorktreeTarget = (
  dependencies: ExistingWorktreeDependencies,
  canonicalRepoPath: string,
  workingDirectory: string,
) =>
  Effect.gen(function* () {
    const { git, settingsConfig } = dependencies;
    if (!(yield* settingsConfig.pathExists(workingDirectory))) {
      return yield* unavailableWorktree(
        `Worktree directory is missing: ${workingDirectory}. Select another worktree.`,
      );
    }
    const canonicalDirectory = yield* git.canonicalizePath(workingDirectory);
    const checkout = yield* classifyWorkspaceCheckout(git, {
      canonicalRepoPath,
      canonicalDirectory,
    });
    if (checkout === "local_repo_root") {
      return yield* unavailableWorktree(
        `${canonicalDirectory} is the current checkout. Choose Current checkout to work there.`,
      );
    }
    if (checkout !== "local_worktree") {
      return yield* unavailableWorktree(
        `${canonicalDirectory} is not a registered worktree of this repository. Select another worktree.`,
      );
    }
    return {
      kind: "local_worktree",
      workingDirectory: canonicalDirectory,
      branchName: yield* currentBranchName(git, canonicalDirectory),
      worktreeState: "present",
    } satisfies WorkspaceSessionExecutionTarget;
  });

const currentBranchName = (git: Pick<GitPort, "getCurrentBranch">, directory: string) =>
  git
    .getCurrentBranch(directory)
    .pipe(Effect.map((branch) => (branch.detached ? null : (branch.name ?? null))));

const unavailableWorktree = (message: string) =>
  new HostValidationError({ field: "existingWorktree.workingDirectory", message });
