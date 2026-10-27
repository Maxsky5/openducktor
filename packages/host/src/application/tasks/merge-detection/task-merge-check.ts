import type { TaskMergeCheckResult } from "@openducktor/contracts";
import { Effect } from "effect";
import { branchReflogEntryKind, rebaseBaseOid } from "../../../domain/task";
import type { GitPort, GitPortError, GitReflogEntry, GitRefTip } from "../../../ports/git-port";

/**
 * Whether a branch got a commit of its own after its creation. `unknown` means the branch has no
 * reflog: Git maintenance expires old reflog entries, so an empty reflog is a normal case. The
 * result depends only on the branch and its tip, so a caller can keep it while the tip stays.
 */
export type OwnCommit = "own" | "none" | "unknown";

/** The own commit result of a branch from its reflog. It runs Git only for a reset entry. */
export const ownCommitOf = (
  gitPort: GitPort,
  gitRepoPath: string,
  reflog: readonly GitReflogEntry[],
): Effect.Effect<OwnCommit, GitPortError> =>
  reflog.length === 0
    ? Effect.succeed("unknown")
    : hasOwnCommit(gitPort, gitRepoPath, reflog).pipe(
        Effect.map((own): OwnCommit => (own ? "own" : "none")),
      );

/**
 * Whether the target tip holds the work of a task branch. A merge commit, a fast-forward, a rebase
 * merge, and a squash merge all count.
 * - `unmergedCommitCount` is the number of branch commits that the target does not have.
 * - `mergedTree` is the tree of a clean merge of the branch into the target, null for a merge with
 *   conflicts. The check needs it only when the target lacks a commit of a branch with its own work.
 */
export const branchMergeResult = (
  check: {
    branchOid: string;
    ownCommit: OwnCommit;
    unmergedCommitCount: number;
    mergedTree: string | null;
  },
  targetTip: Pick<GitRefTip, "treeOid">,
  checkedAt: string,
): TaskMergeCheckResult => {
  const { branchOid, ownCommit, unmergedCommitCount } = check;
  // A branch without a commit of its own is never merged, whatever the target holds.
  if (ownCommit === "none") {
    return { kind: "not_merged", checkedAt, branchOid, unmergedCommitCount: 0 };
  }
  // The target holds every branch commit after a merge commit or a fast-forward.
  if (unmergedCommitCount === 0) {
    // Without reflog entries, the branch can be one that never got a commit. It has nothing to
    // merge, so it is not merged.
    return ownCommit === "own"
      ? { kind: "merged", checkedAt, branchOid }
      : { kind: "not_merged", checkedAt, branchOid, unmergedCommitCount: 0 };
  }
  // The commits that the target lacks are work of the branch, so this needs no reflog.
  // Rebase and squash merges leave other commits, but the target then has the same tree.
  if (check.mergedTree === targetTip.treeOid) return { kind: "merged", checkedAt, branchOid };
  return { kind: "not_merged", checkedAt, branchOid, unmergedCommitCount };
};

/**
 * Whether the branch still has a commit that it got after its creation. A reset sets the branch to
 * its tip, so a commit before the newest reset stays only when that tip holds it. A rebase before
 * that reset replaced the earlier commits, so the rebase counts when the tip holds a commit that
 * the rebase made on its base.
 */
const hasOwnCommit = (gitPort: GitPort, gitRepoPath: string, entries: readonly GitReflogEntry[]) =>
  Effect.gen(function* () {
    let resetTip: string | undefined;
    for (const entry of entries) {
      const kind = branchReflogEntryKind(entry.subject);
      if (kind === "creation") return false;
      if (kind === "reset") {
        resetTip ??= entry.oid;
      } else if (kind === "commit") {
        if (resetTip === undefined) return true;
        if (yield* gitPort.isAncestor(gitRepoPath, entry.oid, resetTip)) return true;
      } else if (kind === "rebase" && resetTip !== undefined) {
        const base = rebaseBaseOid(entry.subject);
        if (
          base !== undefined &&
          (yield* gitPort.isAncestor(gitRepoPath, resetTip, entry.oid)) &&
          !(yield* gitPort.isAncestor(gitRepoPath, resetTip, base))
        ) {
          return true;
        }
      }
    }
    return false;
  });
