import { isMergeDetectionCandidateStatus } from "@openducktor/workflows";

/** Whether the status of a task lets merge detection check it. This needs no Git read. */
export const isMergeDetectionCandidateTask = (task: { status: string }): boolean =>
  isMergeDetectionCandidateStatus(task.status);

/**
 * Whether merge detection checks a task. It adds two rules to `isMergeDetectionCandidateTask`:
 * the task has a branch, and the task has no pending direct merge.
 */
export const isMergeDetectionCandidate = (
  task: { status: string },
  facts: { taskBranch: TaskBranchMatch; hasPendingDirectMerge: boolean },
): boolean =>
  isMergeDetectionCandidateTask(task) &&
  facts.taskBranch.kind !== "none" &&
  // A pending direct merge has its own completion flow.
  !facts.hasPendingDirectMerge;

export type TaskBranchMatch =
  | { kind: "found"; branch: string; oid: string }
  | { kind: "none" }
  | { kind: "ambiguous"; branches: string[] };

/**
 * The task branch is the related branch that the canonical task worktree has checked out.
 * Otherwise it is the only related local branch, which covers a missing worktree and a
 * detached HEAD.
 */
export const pickTaskBranch = (
  relatedBranches: readonly { name: string; oid: string; checkedOutInTaskWorktree: boolean }[],
): TaskBranchMatch => {
  const checkedOut = relatedBranches.find((branch) => branch.checkedOutInTaskWorktree);
  if (checkedOut) return { kind: "found", branch: checkedOut.name, oid: checkedOut.oid };
  const [only, ...others] = relatedBranches;
  if (!only) return { kind: "none" };
  if (others.length === 0) return { kind: "found", branch: only.name, oid: only.oid };
  return { kind: "ambiguous", branches: relatedBranches.map((branch) => branch.name).sort() };
};

export type BranchReflogEntryKind = "commit" | "creation" | "reset" | "other";

/** Git writes these reflog subjects when it makes a new commit on the checked-out branch. */
const OWN_COMMIT_SUBJECT_PREFIXES = ["commit", "cherry-pick:", "revert:", "am:"] as const;

/**
 * The kind of one branch reflog entry. A `commit`, `cherry-pick`, `revert`, or `am` entry gives
 * the branch a commit of its own. `branch: Created` starts the branch. `branch: Reset` and
 * `reset:` move it, and they drop the commits that the new tip does not hold. Pull and rebase
 * entries do not count.
 */
export const branchReflogEntryKind = (subject: string): BranchReflogEntryKind => {
  if (OWN_COMMIT_SUBJECT_PREFIXES.some((prefix) => subject.startsWith(prefix))) return "commit";
  if (subject.startsWith("branch: Created")) return "creation";
  if (subject.startsWith("branch:") || subject.startsWith("reset:")) return "reset";
  return "other";
};
