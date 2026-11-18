import { normalizePathForComparison } from "../../../domain/path-comparison";
import {
  LOCAL_BRANCH_REF_PREFIX,
  localBranchName,
  pickTaskBranch,
  targetBranchName,
  type TaskBranchMatch,
} from "../../../domain/task";
import type { GitPort, GitRefTip } from "../../../ports/git-port";
import type { RepoConfig } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../../effect/host-errors";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import { managedWorktreeBaseForRepoConfig } from "../../git/managed-worktree-roots";
import { isRelatedTaskBranch } from "./task-cleanup-support";
import type { TaskRecord } from "../../../ports/task-repository-ports";

/**
 * Lists every local branch of a repository with its worktree, in one Git call. A task branch can
 * have any name, so task operations filter this list with `relatedTaskBranchTips`.
 */
export const listLocalBranchTips = (gitPort: GitPort, repoPath: string) =>
  gitPort.listRefTips(repoPath, [LOCAL_BRANCH_REF_PREFIX]);

/**
 * The tips of a task: the branch that its canonical worktree has checked out, and the branches
 * under the task branch prefix that an earlier version named from the task ID.
 */
export const relatedTaskBranchTips = (
  tips: readonly GitRefTip[],
  branchPrefix: string,
  checkout: TaskCheckout,
): GitRefTip[] => {
  const ownsBranch = taskBranchOwnership(branchPrefix, checkout);
  return tips.filter((tip) => ownsBranch(localBranchName(tip.ref), tip.worktreePath));
};

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
      name: localBranchName(tip.ref),
      oid: tip.oid,
      checkedOutInTaskWorktree:
        tip.worktreePath !== null && normalizePathForComparison(tip.worktreePath) === worktree,
    })),
  );
};

/** The checkout of a task: its canonical worktree and the name of its target branch. */
export type TaskCheckout = { taskId: string; worktreePath: string; targetBranch: string };

/**
 * The checkout of a task under a managed worktree base. The base must be canonical, as from
 * `readCanonicalManagedWorktreeBase`, because Git reports the real path of each worktree.
 */
export const taskCheckout = (
  settingsConfig: Pick<SettingsConfigPort, "join">,
  canonicalWorktreeBase: string,
  repoConfig: Pick<RepoConfig, "defaultTargetBranch">,
  task: Pick<TaskRecord, "id" | "targetBranch">,
): TaskCheckout => ({
  taskId: task.id,
  worktreePath: settingsConfig.join(canonicalWorktreeBase, task.id),
  targetBranch: targetBranchName(task, repoConfig.defaultTargetBranch),
});

/**
 * Tells whether a task owns a branch: one that its canonical worktree has checked out, or one
 * under the task branch prefix that an earlier version named from the task ID. The target branch of the task is
 * never a task branch, whatever its name, so merge detection never takes it as the source and a
 * cleanup never deletes it.
 */
const taskBranchOwnership = (branchPrefix: string, checkout: TaskCheckout) => {
  const worktree = normalizePathForComparison(checkout.worktreePath);
  return (name: string, worktreePath: string | null): boolean =>
    name !== checkout.targetBranch &&
    (isRelatedTaskBranch(name, branchPrefix, checkout.taskId) ||
      (worktreePath !== null && normalizePathForComparison(worktreePath) === worktree));
};

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
 * The checkout of a task: its canonical worktree, as Git reports worktree paths, and the name of
 * its target branch.
 */
export const readTaskCheckout = (
  gitPort: GitPort,
  settingsConfig: SettingsConfigPort,
  repoConfig: RepoConfig,
  task: Pick<TaskRecord, "id" | "targetBranch">,
) =>
  readCanonicalManagedWorktreeBase(gitPort, settingsConfig, repoConfig).pipe(
    Effect.map((base) => taskCheckout(settingsConfig, base, repoConfig, task)),
  );
/**
 * Lists the local branches of a task that cleanup deletes: the branches under the task branch
 * prefix, and the branch of the task worktree. Fails when a worktree that the cleanup keeps has one
 * of them checked out: Git refuses to delete that branch, and the cleanup deletes branches only
 * after it removes the task worktrees.
 */
export const collectRelatedTaskBranches = (
  { gitPort, settingsConfig }: { gitPort: GitPort; settingsConfig: SettingsConfigPort },
  repoConfig: RepoConfig,
  repoPath: string,
  task: Pick<TaskRecord, "id" | "targetBranch">,
  removedWorktreePaths: string[],
  operationLabel: string,
) =>
  Effect.gen(function* () {
    const checkout = yield* readTaskCheckout(gitPort, settingsConfig, repoConfig, task);
    const ownsBranch = taskBranchOwnership(repoConfig.branchPrefix, checkout);
    const taskId = task.id;
    const branches = yield* gitPort.listBranches(repoPath);
    const removedWorktrees = new Set(removedWorktreePaths.map(normalizePathForComparison));
    const names: string[] = [];
    for (const branch of branches) {
      if (branch.isRemote || !ownsBranch(branch.name, branch.worktreePath ?? null)) continue;
      if (
        branch.worktreePath &&
        !removedWorktrees.has(normalizePathForComparison(branch.worktreePath))
      ) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "taskId",
            message: `Cannot ${operationLabel} task ${taskId} because branch ${branch.name} is checked out in worktree ${branch.worktreePath}. Switch that worktree to another branch, then try again.`,
            details: { repoPath, taskId, branch: branch.name, worktreePath: branch.worktreePath },
          }),
        );
      }
      names.push(branch.name);
    }
    return names.sort();
  });
