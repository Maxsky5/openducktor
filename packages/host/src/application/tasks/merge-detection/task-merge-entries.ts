import {
  type GitTargetBranch,
  type TaskMergeCheckResult,
  type TaskMergeStatus,
  UPSTREAM_TARGET_BRANCH,
} from "@openducktor/contracts";
import {
  canonicalTargetBranch,
  checkoutBranch,
  isMergeDetectionCandidate,
} from "../../../domain/task";
import type { GitRefTip } from "../../../ports/git-port";
import type { TaskRecord } from "../../../ports/task-repository-ports";
import { findTaskBranch } from "../support/task-branch-tips";
import type { OwnCommit } from "./task-merge-check";

/** The task branch and target tips of the last successful check. */
export type CheckedTips = { branchOid: string; targetOid: string };

/** The own commit result of a branch, and the branch tip that it is for. */
export type KnownOwnCommit = { branchOid: string; kind: OwnCommit };

/** The merge status of one task, and the tips that its result is for. */
export type Entry = {
  status: TaskMergeStatus;
  checkedTips: CheckedTips | null;
  ownCommit: KnownOwnCommit | null;
};

/** A task that needs a Git check. */
export type PendingCheck = {
  status: TaskMergeStatus & { branch: string; targetBranch: GitTargetBranch };
  branchOid: string;
  /** The tips of the last check, when it was for the same branch and target. */
  lastTips: CheckedTips | null;
  /** The own commit result of the last check, when it was for the same branch tip. */
  ownCommit: OwnCommit | null;
};

/**
 * Plans the Git check of one task. It gives an entry when no check can run, and null when merge
 * detection does not check the task.
 */
export const planTaskCheck = (
  task: TaskRecord,
  context: {
    relatedTips: GitRefTip[];
    taskWorktreePath: string;
    defaultTarget: GitTargetBranch;
    hasPendingDirectMerge: boolean;
    last: Entry | undefined;
    checkedAt: string;
  },
): { kind: "entry"; entry: Entry } | { kind: "check"; check: PendingCheck } | null => {
  const taskBranch = findTaskBranch(context.relatedTips, context.taskWorktreePath);
  const { hasPendingDirectMerge, last } = context;
  if (!isMergeDetectionCandidate(task, { taskBranch, hasPendingDirectMerge })) return null;
  const branch = taskBranch.kind === "found" ? taskBranch.branch : null;
  const target = task.targetBranchError ? null : (task.targetBranch ?? context.defaultTarget);
  // A result belongs to one branch and target. A changed target needs a new check.
  const carried =
    last?.status.branch === branch && target && sameTarget(last.status.targetBranch, target)
      ? last
      : undefined;
  const status: TaskMergeStatus = {
    taskId: task.id,
    branch,
    targetBranch: target,
    result: carried?.status.result ?? { kind: "not_checked" },
  };
  const failed = (message: string) => ({
    kind: "entry" as const,
    entry: failedEntry(status, message, context.checkedAt),
  });
  if (taskBranch.kind === "ambiguous") {
    const branches = taskBranch.branches.join(", ");
    return failed(
      `More than one local branch belongs to task ${task.id}: ${branches}. Check out one of them in the task worktree, or delete the others.`,
    );
  }
  // The candidate rule leaves out a task without a branch, so this only narrows the type.
  if (taskBranch.kind !== "found") return null;
  if (!target) return failed(task.targetBranchError ?? "The task target branch is invalid.");
  if (checkoutBranch(target) === UPSTREAM_TARGET_BRANCH) {
    return failed(
      "Merge detection needs an explicit target branch. Set the target branch of the task.",
    );
  }
  return {
    kind: "check",
    check: {
      status: { ...status, branch: taskBranch.branch, targetBranch: target },
      branchOid: taskBranch.oid,
      lastTips: carried?.checkedTips ?? null,
      // The own commit result belongs to one branch tip, whatever the target is.
      ownCommit:
        last?.status.branch === branch && last.ownCommit?.branchOid === taskBranch.oid
          ? last.ownCommit.kind
          : null,
    },
  };
};

/**
 * A failed entry keeps its last result. It keeps the cached Git results that the failure does not
 * change. Without checked tips, the next pass checks the task again.
 */
export const failedEntry = (
  status: TaskMergeStatus,
  message: string,
  failedAt: string,
  kept: Pick<Entry, "checkedTips" | "ownCommit"> = {
    checkedTips: null,
    ownCommit: null,
  },
): Entry => ({
  status: { ...status, failure: { message, failedAt } },
  checkedTips: kept.checkedTips,
  ownCommit: kept.ownCommit,
});

export const knownOwnCommit = (check: PendingCheck): KnownOwnCommit | null =>
  check.ownCommit === null ? null : { branchOid: check.branchOid, kind: check.ownCommit };

/** The cached Git results of a pending check. */
export const keptOf = (check: PendingCheck): Pick<Entry, "checkedTips" | "ownCommit"> => ({
  checkedTips: check.lastTips,
  ownCommit: knownOwnCommit(check),
});

const sameTarget = (left: GitTargetBranch | null, right: GitTargetBranch): boolean =>
  left !== null && canonicalTargetBranch(left) === canonicalTargetBranch(right);

export const withCheckedAt = (
  result: TaskMergeCheckResult,
  checkedAt: string,
): TaskMergeCheckResult => (result.kind === "not_checked" ? result : { ...result, checkedAt });

/** Whether a pass changed a status. A new check or failure time alone is no change. */
export const hasStatusChange = (
  last: ReadonlyMap<string, Entry>,
  next: ReadonlyMap<string, Entry>,
): boolean =>
  last.size !== next.size ||
  [...next].some(([taskId, entry]) => {
    const lastEntry = last.get(taskId);
    return lastEntry === undefined || statusKey(lastEntry.status) !== statusKey(entry.status);
  });

const statusKey = ({ failure, ...status }: TaskMergeStatus): string =>
  JSON.stringify({
    ...status,
    result: { ...status.result, checkedAt: undefined },
    failure: failure?.message,
  });
