import type { RepoConfig } from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../../domain/path-comparison";
import { cleanTaskBranchPrefix, pickTaskBranch, type TaskBranchMatch } from "../../../domain/task";
import type { GitPort, GitRefTip } from "../../../ports/git-port";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import { isRelatedTaskBranch, managedWorktreeBaseForRepoConfig } from "./task-cleanup-support";

const LOCAL_BRANCH_REF_PREFIX = "refs/heads/";

export const localBranchName = (tip: GitRefTip): string =>
  tip.ref.slice(LOCAL_BRANCH_REF_PREFIX.length);

/** The `for-each-ref` pattern of the local branches under the task branch prefix. */
export const taskBranchRefPattern = (branchPrefix: string): string =>
  `${LOCAL_BRANCH_REF_PREFIX}${cleanTaskBranchPrefix(branchPrefix)}/`;

/** Lists the local branches under the task branch prefix of a repository, in one Git call. */
export const listTaskBranchTips = (gitPort: GitPort, repoPath: string, branchPrefix: string) =>
  gitPort.listRefTips(repoPath, [taskBranchRefPattern(branchPrefix)]);

export const relatedTaskBranchTips = (
  tips: readonly GitRefTip[],
  branchPrefix: string,
  taskId: string,
): GitRefTip[] =>
  tips.filter((tip) => isRelatedTaskBranch(localBranchName(tip), branchPrefix, taskId));

/**
 * The managed worktree base as Git reports worktree paths. Git stores the real path of each
 * worktree, so a base under a symbolic link must resolve before a comparison.
 */
export const readCanonicalManagedWorktreeBase = (
  gitPort: GitPort,
  settingsConfig: SettingsConfigPort,
  repoConfig: RepoConfig,
) =>
  Effect.gen(function* () {
    const base = managedWorktreeBaseForRepoConfig(settingsConfig, repoConfig);
    return (yield* settingsConfig.pathExists(base)) ? yield* gitPort.canonicalizePath(base) : base;
  });

/**
 * Finds the task branch in the related tips. `taskWorktreePath` must be canonical, because Git
 * reports the real path of each worktree.
 */
export const findTaskBranch = (
  relatedTips: readonly GitRefTip[],
  taskWorktreePath: string,
): TaskBranchMatch => {
  const worktree = normalizePathForComparison(taskWorktreePath);
  return pickTaskBranch(
    relatedTips.map((tip) => ({
      name: localBranchName(tip),
      oid: tip.oid,
      checkedOutInTaskWorktree:
        tip.worktreePath !== null && normalizePathForComparison(tip.worktreePath) === worktree,
    })),
  );
};
