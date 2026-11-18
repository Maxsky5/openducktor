import { Effect } from "effect";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import {
  combineOutput,
  type GitCommandRunner,
  runGit,
  runGitAllowFailure,
} from "./git-command-runner";
import { readHeadRef } from "./git-refs";
import { LOCAL_BRANCH_REF_PREFIX, localBranchName } from "../../domain/task";

/** What the rename reads of one local branch, in the worktree that it renames. */
type BranchState = {
  /** The worktree has this branch checked out. */
  checkedOut: boolean;
  oid: string;
};

/**
 * Reads the local branches of `names` in one Git call. `%(HEAD)` follows the HEAD of the worktree
 * that runs the command. A missing branch has no entry.
 */
const readBranchStates = (runner: GitCommandRunner, workingDirectory: string, names: string[]) =>
  runGit(runner, workingDirectory, [
    "for-each-ref",
    "--format=%(refname)%00%(HEAD)%00%(objectname)",
    ...names.map((name) => `${LOCAL_BRANCH_REF_PREFIX}${name}`),
  ]).pipe(
    Effect.map((output) => {
      const states = new Map<string, BranchState>();
      for (const line of output.split("\n")) {
        const [ref = "", head, oid = ""] = line.split("\0");
        const name = localBranchName(ref);
        // A pattern also matches the branches under it as a folder, so keep exact names only.
        if (!names.includes(name)) continue;
        states.set(name, { checkedOut: head === "*", oid });
      }
      return states;
    }),
  );

/**
 * Renames the branch that a worktree has checked out, without force, so an existing branch stays.
 * The old branch must exist and be checked out. The rename ends only when the worktree has the new
 * branch checked out at the same commit. When Git stops part way and the state cannot be settled,
 * the error names the actual checkout.
 */
export const renameCheckedOutBranch = (
  runner: GitCommandRunner,
  workingDirectory: string,
  expectedBranch: string,
  branch: string,
) =>
  Effect.gen(function* () {
    const readStates = () => readBranchStates(runner, workingDirectory, [expectedBranch, branch]);
    const old = (yield* readStates()).get(expectedBranch);
    if (!old?.checkedOut)
      return yield* new HostValidationError({
        message: `The worktree ${workingDirectory} no longer has branch ${expectedBranch} checked out, so OpenDucktor did not rename it.`,
        field: "branchName",
      });
    const commit = old.oid;
    const describeCheckout = Effect.gen(function* () {
      const head = yield* readHeadRef(runner, workingDirectory);
      const states = yield* readStates();
      return `The worktree ${workingDirectory} now has ${head ? head.replace(LOCAL_BRANCH_REF_PREFIX, "branch ") : "a detached HEAD"} checked out. Branch ${expectedBranch} ${states.has(expectedBranch) ? "exists" : "does not exist"}, and branch ${branch} ${states.has(branch) ? "exists" : "does not exist"}.`;
    });
    const renamed = yield* runGitAllowFailure(runner, workingDirectory, [
      "branch",
      "-m",
      expectedBranch,
      branch,
    ]);
    const states = yield* readStates();
    if (!renamed.ok) {
      const stillOld = states.get(expectedBranch);
      const unchanged =
        stillOld?.checkedOut === true && stillOld.oid === commit && !states.has(branch);
      if (unchanged)
        return yield* new HostOperationError({
          message: `Git could not rename branch ${expectedBranch} to ${branch}: ${combineOutput(renamed.stdout, renamed.stderr)}`,
          operation: "git.branch.rename",
        });
      return yield* new HostOperationError({
        message: `Git stopped part way through the rename of branch ${expectedBranch} to ${branch}: ${combineOutput(renamed.stdout, renamed.stderr)} ${yield* describeCheckout} Rename the branch in Git so that the worktree has one branch checked out, then send the message again.`,
        operation: "git.branch.rename",
      });
    }
    const current = states.get(branch);
    if (!current?.checkedOut || current.oid !== commit)
      return yield* new HostValidationError({
        message: `Git did not leave branch ${branch} checked out at ${commit}. ${yield* describeCheckout}`,
        field: "branchName",
      });
  });
