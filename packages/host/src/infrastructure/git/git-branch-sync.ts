import type {
  GitCommitAllResult,
  GitConflictAbortResult,
  GitConflictOperation,
  GitPullBranchResult,
  GitRebaseAbortResult,
  GitRebaseBranchResult,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import {
  combineOptionalOutput,
  type GitCommandRunner,
  requireNonEmptyEffect,
  runGit,
  runGitAllowFailure,
} from "./git-command-runner";
import { getCurrentBranchUnchecked, getStatusUnchecked } from "./git-status";
import {
  commitsAgainstTargetOrDefault,
  resolveUpstreamTargetConfigForBranch,
} from "./git-upstream";

const gitOperationError = (message: string, operation: string): HostOperationError =>
  new HostOperationError({ message, operation });
const gitValidationError = (message: string, operation: string): HostValidationError =>
  new HostValidationError({ message, details: { operation } });
type GitBranchSyncError = HostOperationError | HostValidationError;
export const pullBranch = (
  runner: GitCommandRunner,
  workingDirectory: string,
): Effect.Effect<GitPullBranchResult, GitBranchSyncError> =>
  Effect.gen(function* () {
    const currentBranch = yield* getCurrentBranchUnchecked(runner, workingDirectory);
    if (currentBranch.detached) {
      return yield* Effect.fail(gitValidationError("Cannot pull while detached", "git.pull"));
    }
    const upstreamTarget = yield* resolveUpstreamTargetConfigForBranch(
      runner,
      workingDirectory,
      currentBranch.name,
    );
    if (!upstreamTarget) {
      return yield* Effect.fail(
        gitValidationError(
          "Cannot pull because current branch does not track an upstream branch",
          "git.pull",
        ),
      );
    }
    if ((yield* getStatusUnchecked(runner, workingDirectory)).length > 0) {
      return yield* Effect.fail(
        gitValidationError("Cannot pull with uncommitted changes", "git.pull"),
      );
    }
    if (upstreamTarget.remote !== ".") {
      const fetchRefspec = `+${upstreamTarget.mergeRef}:${upstreamTarget.upstreamRef}`;
      const fetchResult = yield* runGitAllowFailure(runner, workingDirectory, [
        "fetch",
        "--prune",
        "--",
        upstreamTarget.remote,
        fetchRefspec,
      ]);
      if (!fetchResult.ok) {
        return yield* Effect.fail(
          gitOperationError(
            `git fetch --prune ${upstreamTarget.remote} failed: ${combineOptionalOutput(fetchResult.stdout, fetchResult.stderr)}`,
            "git.fetch",
          ),
        );
      }
    }
    const upstreamCounts = yield* commitsAgainstTargetOrDefault(
      runner,
      workingDirectory,
      upstreamTarget.upstreamRef,
    );
    if (upstreamCounts.behind === 0) {
      return {
        outcome: "up_to_date",
        output: "No upstream commits to pull",
      };
    }
    const beforeHead = yield* runGit(runner, workingDirectory, ["rev-parse", "HEAD"]);
    const command =
      upstreamCounts.ahead === 0
        ? {
            name: "git merge --ff-only",
            args: ["merge", "--ff-only", upstreamTarget.upstreamRef],
          }
        : {
            name: "git rebase --no-fork-point",
            args: ["rebase", "--no-fork-point", upstreamTarget.upstreamRef],
          };
    const commandResult = yield* runGitAllowFailure(runner, workingDirectory, command.args);
    const output = combineOptionalOutput(commandResult.stdout, commandResult.stderr);
    if (!commandResult.ok) {
      const detail = output.length > 0 ? output : `No output from ${command.name}`;
      const conflictedFiles = (yield* getStatusUnchecked(runner, workingDirectory))
        .filter((statusEntry) => statusEntry.status === "unmerged")
        .map((statusEntry) => statusEntry.path);
      if (conflictedFiles.length > 0) {
        return {
          outcome: "conflicts",
          conflictedFiles,
          output: detail,
        };
      }
      return yield* Effect.fail(
        gitOperationError(`${command.name} failed: ${detail}`, command.name),
      );
    }
    const afterHead = yield* runGit(runner, workingDirectory, ["rev-parse", "HEAD"]);
    if (beforeHead === afterHead) {
      return {
        outcome: "up_to_date",
        output,
      };
    }
    return {
      outcome: "pulled",
      output,
    };
  });
export const commitAll = (
  runner: GitCommandRunner,
  workingDirectory: string,
  message: string,
): Effect.Effect<GitCommitAllResult, GitBranchSyncError> =>
  Effect.gen(function* () {
    const commitMessage = yield* requireNonEmptyEffect(message, "commit message");
    const addResult = yield* runGitAllowFailure(runner, workingDirectory, ["add", "-A"]);
    if (!addResult.ok) {
      return yield* Effect.fail(
        gitOperationError(
          `git add -A failed: ${combineOptionalOutput(addResult.stdout, addResult.stderr)}`,
          "git.add",
        ),
      );
    }
    const stagedAfterAdd = yield* runGit(runner, workingDirectory, [
      "diff",
      "--cached",
      "--name-only",
    ]);
    if (stagedAfterAdd.split(/\r?\n/).every((line) => line.trim().length === 0)) {
      return {
        outcome: "no_changes",
        output: "No staged changes to commit",
      };
    }
    const commitResult = yield* runGitAllowFailure(runner, workingDirectory, [
      "commit",
      "-m",
      commitMessage,
    ]);
    const output = combineOptionalOutput(commitResult.stdout, commitResult.stderr);
    if (!commitResult.ok) {
      return yield* Effect.fail(
        gitOperationError(`git commit-all failed: ${output}`, "git.commit"),
      );
    }
    return {
      outcome: "committed",
      commitHash: (yield* runGit(runner, workingDirectory, ["rev-parse", "HEAD"])).trim(),
      output,
    };
  });
export const rebaseBranch = (
  runner: GitCommandRunner,
  workingDirectory: string,
  targetBranch: string,
): Effect.Effect<GitRebaseBranchResult, GitBranchSyncError> =>
  Effect.gen(function* () {
    const target = yield* requireNonEmptyEffect(targetBranch, "target branch");
    const current = yield* getCurrentBranchUnchecked(runner, workingDirectory);
    if (current.detached) {
      return yield* Effect.fail(gitValidationError("Cannot rebase while detached", "git.rebase"));
    }
    if ((yield* getStatusUnchecked(runner, workingDirectory)).length > 0) {
      return yield* Effect.fail(
        gitValidationError("Cannot rebase with uncommitted changes", "git.rebase"),
      );
    }
    const alreadyBased = yield* runGitAllowFailure(runner, workingDirectory, [
      "merge-base",
      "--is-ancestor",
      target,
      "HEAD",
    ]);
    if (alreadyBased.ok) {
      return {
        outcome: "up_to_date",
        output: "Branch already contains target history",
      };
    }
    const rebaseResult = yield* runGitAllowFailure(runner, workingDirectory, [
      "rebase",
      "--end-of-options",
      target,
    ]);
    const output = combineOptionalOutput(rebaseResult.stdout, rebaseResult.stderr);
    if (rebaseResult.ok) {
      return {
        outcome: "rebased",
        output,
      };
    }
    const detail = output.length > 0 ? output : "No output from git rebase";
    const conflictedFiles = (yield* getStatusUnchecked(runner, workingDirectory))
      .filter((statusEntry) => statusEntry.status === "unmerged")
      .map((statusEntry) => statusEntry.path);
    if (conflictedFiles.length > 0) {
      return {
        outcome: "conflicts",
        conflictedFiles,
        output: detail,
      };
    }
    return yield* Effect.fail(gitOperationError(`git rebase failed: ${detail}`, "git.rebase"));
  });
export const rebaseAbort = (
  runner: GitCommandRunner,
  workingDirectory: string,
): Effect.Effect<GitRebaseAbortResult, GitBranchSyncError> =>
  Effect.gen(function* () {
    const abortResult = yield* runGitAllowFailure(runner, workingDirectory, ["rebase", "--abort"]);
    const output = combineOptionalOutput(abortResult.stdout, abortResult.stderr);
    if (!abortResult.ok) {
      const detail = output.length > 0 ? output : "No output from git rebase --abort";
      return yield* Effect.fail(
        gitOperationError(`git rebase --abort failed: ${detail}`, "git.rebase.abort"),
      );
    }
    return {
      outcome: "aborted",
      output,
    };
  });
export const conflictAbortArgs = (operation: GitConflictOperation): string[] => {
  if (operation === "direct_merge_merge_commit") {
    return ["merge", "--abort"];
  }
  if (operation === "direct_merge_squash") {
    return ["reset", "--hard", "HEAD"];
  }
  return ["rebase", "--abort"];
};
export const abortConflict = (
  runner: GitCommandRunner,
  workingDirectory: string,
  operation: GitConflictOperation,
): Effect.Effect<GitConflictAbortResult, GitBranchSyncError> =>
  Effect.gen(function* () {
    const args = conflictAbortArgs(operation);
    const abortResult = yield* runGitAllowFailure(runner, workingDirectory, args);
    const output = combineOptionalOutput(abortResult.stdout, abortResult.stderr);
    if (!abortResult.ok) {
      const detail = output.length > 0 ? output : `No output from git ${args.join(" ")}`;
      return yield* Effect.fail(
        gitOperationError(`git conflict abort failed: ${detail}`, "git.conflict.abort"),
      );
    }
    return { output };
  });
