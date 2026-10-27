import { Effect } from "effect";
import { errorMessage, type HostOperationError } from "../../../effect/host-errors";
import type { GitPort, GitRefTip } from "../../../ports/git-port";
import { branchMergeResult, type OwnCommit, ownCommitOf } from "./task-merge-check";
import { type Entry, failedEntry, keptOf, type PendingCheck } from "./task-merge-entries";

/** A task whose branch tip or target tip moved since its last check. */
export type MovedTask = { check: PendingCheck; targetTip: GitRefTip };

type KnownTask = MovedTask & { ownCommit: OwnCommit };
type CountedTask = KnownTask & { unmergedCommitCount: number };

const branchRef = (task: MovedTask): string => `refs/heads/${task.check.status.branch}`;

/** Only a branch with work of its own that the target lacks needs the tree check. */
const needsTreeCheck = (task: CountedTask): boolean =>
  task.ownCommit !== "none" && task.unmergedCommitCount > 0;

/**
 * Checks the tasks whose branch or target tip moved, in few Git calls, whatever the task count:
 * - One call reads the reflogs of all new branch tips. A reset entry adds one call.
 * - One call for each target tip counts the branch commits that the target does not have.
 * - One call writes the merge trees of every branch that needs the tree check.
 *
 * A failed read fails the checks that need it, and each of them keeps its last result.
 */
export const checkMovedTasks = ({
  gitPort,
  gitRepoPath,
  branchRefPattern,
  moved,
  checkedAt,
  withPermit,
  logFailure,
}: {
  gitPort: GitPort;
  gitRepoPath: string;
  /** The `for-each-ref` pattern that matches every task branch. */
  branchRefPattern: string;
  moved: readonly MovedTask[];
  checkedAt: string;
  /** Limits the Git commands that run at a time. */
  withPermit: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E>;
  logFailure: (taskIds: string[], message: string) => Effect.Effect<void, HostOperationError>;
}) =>
  Effect.gen(function* () {
    const entries: Entry[] = [];
    // A failed task keeps the own commit result that its branch tip already has.
    const fail = (tasks: readonly (MovedTask | KnownTask)[], message: string) =>
      Effect.gen(function* () {
        for (const task of tasks) {
          const { check } = task;
          const ownCommit =
            "ownCommit" in task
              ? { branchOid: check.branchOid, kind: task.ownCommit }
              : keptOf(check).ownCommit;
          entries.push(
            failedEntry(check.status, message, checkedAt, { checkedTips: null, ownCommit }),
          );
        }
        yield* logFailure(
          tasks.map(({ check }) => check.status.taskId),
          message,
        );
      });

    const known: KnownTask[] = [];
    // The own commit result stays while the branch tip stays, so only a new tip reads its reflog.
    const unread: MovedTask[] = [];
    for (const task of moved) {
      if (task.check.ownCommit === null) unread.push(task);
      else known.push({ ...task, ownCommit: task.check.ownCommit });
    }
    if (unread.length > 0) {
      const reflogs = yield* Effect.result(
        withPermit(gitPort.readReflogs(gitRepoPath, unread.map(branchRef))),
      );
      if (reflogs._tag === "Failure") yield* fail(unread, errorMessage(reflogs.failure));
      else
        yield* Effect.forEach(
          unread,
          (task) =>
            Effect.gen(function* () {
              const reflog = reflogs.success.get(branchRef(task)) ?? [];
              const read = yield* Effect.result(
                withPermit(ownCommitOf(gitPort, gitRepoPath, reflog)),
              );
              if (read._tag === "Success") known.push({ ...task, ownCommit: read.success });
              else yield* fail([task], errorMessage(read.failure));
            }),
          { concurrency: "unbounded", discard: true },
        );
    }

    // A branch without a commit of its own needs no count: it is never merged.
    const counted: CountedTask[] = known
      .filter((task) => task.ownCommit === "none")
      .map((task) => ({ ...task, unmergedCommitCount: 0 }));
    const byTarget = new Map<string, KnownTask[]>();
    for (const task of known) {
      if (task.ownCommit === "none") continue;
      const tasks = byTarget.get(task.targetTip.oid);
      if (tasks) tasks.push(task);
      else byTarget.set(task.targetTip.oid, [task]);
    }
    yield* Effect.forEach(
      byTarget,
      ([targetOid, tasks]) =>
        Effect.gen(function* () {
          const counts = yield* Effect.result(
            withPermit(gitPort.countCommitsAhead(gitRepoPath, targetOid, [branchRefPattern])),
          );
          if (counts._tag === "Failure") return yield* fail(tasks, errorMessage(counts.failure));
          for (const task of tasks) {
            const unmergedCommitCount = counts.success.get(branchRef(task));
            if (unmergedCommitCount !== undefined) counted.push({ ...task, unmergedCommitCount });
            else yield* fail([task], `Task branch ${task.check.status.branch} no longer exists.`);
          }
        }),
      { concurrency: "unbounded", discard: true },
    );

    const needsTree = counted.filter(needsTreeCheck);
    const pairs = needsTree.map(({ targetTip, check }) => ({
      first: targetTip.oid,
      second: check.branchOid,
    }));
    const trees = yield* Effect.result(
      pairs.length === 0
        ? Effect.succeed([])
        : withPermit(gitPort.mergeTreeOids(gitRepoPath, pairs)),
    );
    if (trees._tag === "Failure") yield* fail(needsTree, errorMessage(trees.failure));
    const mergedTrees = new Map<CountedTask, string | null>(
      trees._tag === "Success"
        ? needsTree.map((task, index) => [task, trees.success[index] ?? null])
        : [],
    );
    for (const task of counted) {
      if (needsTreeCheck(task) && trees._tag === "Failure") continue;
      const { status, branchOid } = task.check;
      const result = branchMergeResult(
        {
          branchOid,
          ownCommit: task.ownCommit,
          unmergedCommitCount: task.unmergedCommitCount,
          mergedTree: mergedTrees.get(task) ?? null,
        },
        task.targetTip,
        checkedAt,
      );
      entries.push({
        status: { ...status, result },
        checkedTips: { branchOid, targetOid: task.targetTip.oid },
        ownCommit: { branchOid, kind: task.ownCommit },
      });
    }
    return entries;
  });
