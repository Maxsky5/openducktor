import { Effect } from "effect";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { GitMergeBranchRequest } from "../../ports/git-port";
import {
  combineOptionalOutput,
  combineOutput,
  type GitCommandRunner,
  requireNonEmptyEffect,
  runGit,
  runGitAllowFailure,
} from "./git-command-runner";
import { getCurrentBranchUnchecked, getStatusUnchecked, parseBranchRows } from "./git-status";

const gitOperationError = (message: string, operation: string): HostOperationError =>
  new HostOperationError({ message, operation });
const gitValidationError = (message: string, field: string): HostValidationError =>
  new HostValidationError({ message, field });
export const isAncestor = (
  runner: GitCommandRunner,
  workingDirectory: string,
  ancestor: string,
  descendant: string,
) =>
  Effect.gen(function* () {
    const ancestorRef = yield* requireNonEmptyEffect(ancestor, "ancestor ref");
    const descendantRef = yield* requireNonEmptyEffect(descendant, "descendant ref");
    const result = yield* runGitAllowFailure(runner, workingDirectory, [
      "merge-base",
      "--is-ancestor",
      "--end-of-options",
      ancestorRef,
      descendantRef,
    ]);
    if (result.ok) {
      return true;
    }
    if (!result.stdout.trim() && !result.stderr.trim()) {
      return false;
    }
    return yield* Effect.fail(
      gitOperationError(
        `git merge-base --is-ancestor ${ancestorRef} ${descendantRef} failed: ${combineOutput(result.stdout, result.stderr)}`,
        "git.merge-base.is-ancestor",
      ),
    );
  });
export const suggestedSquashCommitMessage = (
  runner: GitCommandRunner,
  workingDirectory: string,
  sourceBranch: string,
  targetBranch: string,
) =>
  Effect.gen(function* () {
    const sourceRef = yield* requireNonEmptyEffect(sourceBranch, "source branch");
    const targetRef = yield* requireNonEmptyEffect(targetBranch, "target branch");
    const revListResult = yield* runGitAllowFailure(runner, workingDirectory, [
      "rev-list",
      "--reverse",
      "--end-of-options",
      `${targetRef}..${sourceRef}`,
    ]);
    if (!revListResult.ok) {
      return yield* Effect.fail(
        gitOperationError(
          `git rev-list ${targetRef}..${sourceRef} failed: ${combineOutput(revListResult.stdout, revListResult.stderr)}`,
          "git.rev-list",
        ),
      );
    }
    const oldestCommit = revListResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (!oldestCommit) {
      return undefined;
    }
    const message = (yield* runGit(runner, workingDirectory, [
      "show",
      "-s",
      "--format=%B",
      oldestCommit,
    ])).trim();
    return message.length > 0 ? message : undefined;
  });
const checkoutBranchFromTargetRef = (targetRef: string): string => {
  const slash = targetRef.indexOf("/");
  return slash >= 0 ? targetRef.slice(slash + 1) : targetRef;
};
const finishMergeBranchResult = (
  runner: GitCommandRunner,
  workingDirectory: string,
  beforeHead: string,
  output: string,
) =>
  Effect.gen(function* () {
    const afterHead = yield* runGit(runner, workingDirectory, ["rev-parse", "HEAD"]);
    if (beforeHead === afterHead) {
      return {
        outcome: "up_to_date" as const,
        output,
      };
    }
    return {
      outcome: "merged" as const,
      output,
    };
  });
const mergeConflictOrError = (
  runner: GitCommandRunner,
  workingDirectory: string,
  commandName: string,
  output: string,
) =>
  Effect.gen(function* () {
    const detail = output.length > 0 ? output : `No output from ${commandName}`;
    const conflictedFiles = (yield* getStatusUnchecked(runner, workingDirectory))
      .filter((statusEntry) => statusEntry.status === "unmerged")
      .map((statusEntry) => statusEntry.path);
    if (conflictedFiles.length > 0) {
      return {
        outcome: "conflicts" as const,
        conflictedFiles,
        output: detail,
      };
    }
    return yield* Effect.fail(gitOperationError(`${commandName} failed: ${detail}`, commandName));
  });
const mergeBranchWithCommit = (
  runner: GitCommandRunner,
  workingDirectory: string,
  sourceBranch: string,
  beforeHead: string,
) =>
  Effect.gen(function* () {
    const result = yield* runGitAllowFailure(runner, workingDirectory, [
      "merge",
      "--no-ff",
      "--end-of-options",
      sourceBranch,
    ]);
    const output = combineOptionalOutput(result.stdout, result.stderr);
    if (!result.ok) {
      return yield* mergeConflictOrError(runner, workingDirectory, "git merge --no-ff", output);
    }
    return yield* finishMergeBranchResult(runner, workingDirectory, beforeHead, output);
  });
const mergeBranchWithSquash = (
  runner: GitCommandRunner,
  workingDirectory: string,
  sourceBranch: string,
  beforeHead: string,
  squashCommitMessage: string | undefined,
) =>
  Effect.gen(function* () {
    const commitMessage = yield* requireNonEmptyEffect(
      squashCommitMessage ?? "",
      "squash commit message",
    );
    const result = yield* runGitAllowFailure(runner, workingDirectory, [
      "merge",
      "--squash",
      "--end-of-options",
      sourceBranch,
    ]);
    const output = combineOptionalOutput(result.stdout, result.stderr);
    if (!result.ok) {
      return yield* mergeConflictOrError(runner, workingDirectory, "git merge --squash", output);
    }
    const staged = yield* runGitAllowFailure(runner, workingDirectory, [
      "diff",
      "--cached",
      "--quiet",
    ]);
    if (staged.ok) {
      return {
        outcome: "up_to_date" as const,
        output,
      };
    }
    const commit = yield* runGitAllowFailure(runner, workingDirectory, [
      "commit",
      "-m",
      commitMessage,
    ]);
    const commitOutput = combineOptionalOutput(commit.stdout, commit.stderr);
    if (!commit.ok) {
      return yield* Effect.fail(
        gitOperationError(
          `git commit failed after squash merge: ${commitOutput}`,
          "git.commit.squash-merge",
        ),
      );
    }
    const mergedOutput =
      output.length === 0
        ? commitOutput
        : commitOutput.length === 0
          ? output
          : `${output}\n${commitOutput}`;
    return yield* finishMergeBranchResult(runner, workingDirectory, beforeHead, mergedOutput);
  });
const mergeBranchWithRebase = (
  runner: GitCommandRunner,
  workingDirectory: string,
  sourceWorkingDirectory: string | undefined,
  sourceBranch: string,
  targetBranch: string,
  beforeHead: string,
) =>
  Effect.gen(function* () {
    const rebaseWorkingDirectory = sourceWorkingDirectory ?? workingDirectory;
    const rebase = yield* runGitAllowFailure(runner, rebaseWorkingDirectory, [
      "rebase",
      "--end-of-options",
      targetBranch,
    ]);
    const rebaseOutput = combineOptionalOutput(rebase.stdout, rebase.stderr);
    if (!rebase.ok) {
      return yield* mergeConflictOrError(
        runner,
        rebaseWorkingDirectory,
        "git rebase",
        rebaseOutput,
      );
    }
    const fastForward = yield* runGitAllowFailure(runner, workingDirectory, [
      "merge",
      "--ff-only",
      "--end-of-options",
      sourceBranch,
    ]);
    const fastForwardOutput = combineOptionalOutput(fastForward.stdout, fastForward.stderr);
    if (!fastForward.ok) {
      return yield* Effect.fail(
        gitOperationError(
          `git merge --ff-only failed after rebase: ${fastForwardOutput}`,
          "git.merge.ff-only",
        ),
      );
    }
    const output =
      rebaseOutput.length === 0
        ? fastForwardOutput
        : fastForwardOutput.length === 0
          ? rebaseOutput
          : `${rebaseOutput}\n${fastForwardOutput}`;
    return yield* finishMergeBranchResult(runner, workingDirectory, beforeHead, output);
  });
export const mergeBranch = (
  runner: GitCommandRunner,
  workingDirectory: string,
  request: GitMergeBranchRequest,
) =>
  Effect.gen(function* () {
    const sourceBranch = yield* requireNonEmptyEffect(request.sourceBranch, "source branch");
    const targetBranch = yield* requireNonEmptyEffect(request.targetBranch, "target branch");
    const branches = parseBranchRows(
      yield* runGit(runner, workingDirectory, [
        "for-each-ref",
        "--format=%(if)%(HEAD)%(then)1%(else)0%(end)|%(refname:short)|%(refname)",
        "refs/heads",
        "refs/remotes",
      ]),
    );
    const checkoutTargetBranch = branches.some(
      (branch) => branch.isRemote && branch.name === targetBranch,
    )
      ? checkoutBranchFromTargetRef(targetBranch)
      : targetBranch;
    if (sourceBranch === targetBranch) {
      return {
        outcome: "up_to_date" as const,
        output: "Source and target branches are identical",
      };
    }
    if ((yield* getStatusUnchecked(runner, workingDirectory)).length > 0) {
      return yield* Effect.fail(
        gitValidationError("Cannot merge with uncommitted changes", "workingDirectory"),
      );
    }
    yield* switchBranch(runner, workingDirectory, checkoutTargetBranch, false);
    const beforeHead = yield* runGit(runner, workingDirectory, ["rev-parse", "HEAD"]);
    if (request.method === "merge_commit") {
      return yield* mergeBranchWithCommit(runner, workingDirectory, sourceBranch, beforeHead);
    }
    if (request.method === "squash") {
      return yield* mergeBranchWithSquash(
        runner,
        workingDirectory,
        sourceBranch,
        beforeHead,
        request.squashCommitMessage,
      );
    }
    return yield* mergeBranchWithRebase(
      runner,
      workingDirectory,
      request.sourceWorkingDirectory,
      sourceBranch,
      checkoutTargetBranch,
      beforeHead,
    );
  });
export const switchBranch = (
  runner: GitCommandRunner,
  workingDirectory: string,
  branch: string,
  create: boolean,
) =>
  Effect.gen(function* () {
    const targetBranch = yield* requireNonEmptyEffect(branch, "branch");
    const args = create
      ? ["switch", "-c", targetBranch]
      : ["switch", "--end-of-options", targetBranch];
    yield* runGit(runner, workingDirectory, args);
    return yield* getCurrentBranchUnchecked(runner, workingDirectory);
  });
