import type {
  GitCommitAllResult,
  GitConflictAbortResult,
  GitConflictOperation,
  GitPullBranchResult,
  GitRebaseAbortResult,
  GitRebaseBranchResult,
} from "@openducktor/contracts";
import {
  combineOptionalOutput,
  type GitCommandRunner,
  requireNonEmpty,
  runGit,
  runGitAllowFailure,
} from "./git-command-runner";
import { getCurrentBranchUnchecked, getStatusUnchecked } from "./git-status";
import {
  commitsAgainstTargetOrDefault,
  resolveUpstreamTargetConfigForBranch,
} from "./git-upstream";

export const pullBranch = async (
  runner: GitCommandRunner,
  workingDirectory: string,
): Promise<GitPullBranchResult> => {
  const currentBranch = await getCurrentBranchUnchecked(runner, workingDirectory);
  if (currentBranch.detached) {
    throw new Error("Cannot pull while detached");
  }

  const upstreamTarget = await resolveUpstreamTargetConfigForBranch(
    runner,
    workingDirectory,
    currentBranch.name,
  );
  if (!upstreamTarget) {
    throw new Error("Cannot pull because current branch does not track an upstream branch");
  }

  if ((await getStatusUnchecked(runner, workingDirectory)).length > 0) {
    throw new Error("Cannot pull with uncommitted changes");
  }

  if (upstreamTarget.remote !== ".") {
    const fetchRefspec = `+${upstreamTarget.mergeRef}:${upstreamTarget.upstreamRef}`;
    const fetchResult = await runGitAllowFailure(runner, workingDirectory, [
      "fetch",
      "--prune",
      "--",
      upstreamTarget.remote,
      fetchRefspec,
    ]);
    if (!fetchResult.ok) {
      throw new Error(
        `git fetch --prune ${upstreamTarget.remote} failed: ${combineOptionalOutput(
          fetchResult.stdout,
          fetchResult.stderr,
        )}`,
      );
    }
  }

  const upstreamCounts = await commitsAgainstTargetOrDefault(
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

  const beforeHead = await runGit(runner, workingDirectory, ["rev-parse", "HEAD"]);
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

  const commandResult = await runGitAllowFailure(runner, workingDirectory, command.args);
  const output = combineOptionalOutput(commandResult.stdout, commandResult.stderr);
  if (!commandResult.ok) {
    const detail = output.length > 0 ? output : `No output from ${command.name}`;
    const conflictedFiles = (await getStatusUnchecked(runner, workingDirectory))
      .filter((statusEntry) => statusEntry.status === "unmerged")
      .map((statusEntry) => statusEntry.path);
    if (conflictedFiles.length > 0) {
      return {
        outcome: "conflicts",
        conflictedFiles,
        output: detail,
      };
    }

    throw new Error(`${command.name} failed: ${detail}`);
  }

  const afterHead = await runGit(runner, workingDirectory, ["rev-parse", "HEAD"]);
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
};

export const commitAll = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  message: string,
): Promise<GitCommitAllResult> => {
  const commitMessage = requireNonEmpty(message, "commit message");
  const addResult = await runGitAllowFailure(runner, workingDirectory, ["add", "-A"]);
  if (!addResult.ok) {
    throw new Error(
      `git add -A failed: ${combineOptionalOutput(addResult.stdout, addResult.stderr)}`,
    );
  }

  const stagedAfterAdd = await runGit(runner, workingDirectory, [
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

  const commitResult = await runGitAllowFailure(runner, workingDirectory, [
    "commit",
    "-m",
    commitMessage,
  ]);
  const output = combineOptionalOutput(commitResult.stdout, commitResult.stderr);
  if (!commitResult.ok) {
    throw new Error(`git commit-all failed: ${output}`);
  }

  return {
    outcome: "committed",
    commitHash: (await runGit(runner, workingDirectory, ["rev-parse", "HEAD"])).trim(),
    output,
  };
};

export const rebaseBranch = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  targetBranch: string,
): Promise<GitRebaseBranchResult> => {
  const target = requireNonEmpty(targetBranch, "target branch");
  const current = await getCurrentBranchUnchecked(runner, workingDirectory);
  if (current.detached) {
    throw new Error("Cannot rebase while detached");
  }

  if ((await getStatusUnchecked(runner, workingDirectory)).length > 0) {
    throw new Error("Cannot rebase with uncommitted changes");
  }

  const alreadyBased = await runGitAllowFailure(runner, workingDirectory, [
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

  const rebaseResult = await runGitAllowFailure(runner, workingDirectory, [
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
  const conflictedFiles = (await getStatusUnchecked(runner, workingDirectory))
    .filter((statusEntry) => statusEntry.status === "unmerged")
    .map((statusEntry) => statusEntry.path);
  if (conflictedFiles.length > 0) {
    return {
      outcome: "conflicts",
      conflictedFiles,
      output: detail,
    };
  }

  throw new Error(`git rebase failed: ${detail}`);
};

export const rebaseAbort = async (
  runner: GitCommandRunner,
  workingDirectory: string,
): Promise<GitRebaseAbortResult> => {
  const abortResult = await runGitAllowFailure(runner, workingDirectory, ["rebase", "--abort"]);
  const output = combineOptionalOutput(abortResult.stdout, abortResult.stderr);
  if (!abortResult.ok) {
    const detail = output.length > 0 ? output : "No output from git rebase --abort";
    throw new Error(`git rebase --abort failed: ${detail}`);
  }

  return {
    outcome: "aborted",
    output,
  };
};

export const conflictAbortArgs = (operation: GitConflictOperation): string[] => {
  if (operation === "direct_merge_merge_commit") {
    return ["merge", "--abort"];
  }
  if (operation === "direct_merge_squash") {
    return ["reset", "--hard", "HEAD"];
  }

  return ["rebase", "--abort"];
};

export const abortConflict = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  operation: GitConflictOperation,
): Promise<GitConflictAbortResult> => {
  const args = conflictAbortArgs(operation);
  const abortResult = await runGitAllowFailure(runner, workingDirectory, args);
  const output = combineOptionalOutput(abortResult.stdout, abortResult.stderr);
  if (!abortResult.ok) {
    const detail = output.length > 0 ? output : `No output from git ${args.join(" ")}`;
    throw new Error(`git conflict abort failed: ${detail}`);
  }

  return { output };
};
