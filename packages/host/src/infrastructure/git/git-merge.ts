import type { GitCurrentBranch } from "@openducktor/contracts";
import type { GitMergeBranchRequest } from "../../ports/git-port";
import {
  combineOptionalOutput,
  combineOutput,
  type GitCommandRunner,
  requireNonEmpty,
  runGit,
  runGitAllowFailure,
} from "./git-command-runner";
import { getCurrentBranchUnchecked, getStatusUnchecked, parseBranchRows } from "./git-status";

export const isAncestor = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  ancestor: string,
  descendant: string,
): Promise<boolean> => {
  const ancestorRef = requireNonEmpty(ancestor, "ancestor ref");
  const descendantRef = requireNonEmpty(descendant, "descendant ref");
  const result = await runGitAllowFailure(runner, workingDirectory, [
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

  throw new Error(
    `git merge-base --is-ancestor ${ancestorRef} ${descendantRef} failed: ${combineOutput(
      result.stdout,
      result.stderr,
    )}`,
  );
};

export const suggestedSquashCommitMessage = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  sourceBranch: string,
  targetBranch: string,
): Promise<string | undefined> => {
  const sourceRef = requireNonEmpty(sourceBranch, "source branch");
  const targetRef = requireNonEmpty(targetBranch, "target branch");
  const revListResult = await runGitAllowFailure(runner, workingDirectory, [
    "rev-list",
    "--reverse",
    "--end-of-options",
    `${targetRef}..${sourceRef}`,
  ]);
  if (!revListResult.ok) {
    throw new Error(
      `git rev-list ${targetRef}..${sourceRef} failed: ${combineOutput(
        revListResult.stdout,
        revListResult.stderr,
      )}`,
    );
  }

  const oldestCommit = revListResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!oldestCommit) {
    return undefined;
  }

  const message = (
    await runGit(runner, workingDirectory, ["show", "-s", "--format=%B", oldestCommit])
  ).trim();
  return message.length > 0 ? message : undefined;
};

export const checkoutBranchFromTargetRef = (targetRef: string): string => {
  const slash = targetRef.indexOf("/");
  return slash >= 0 ? targetRef.slice(slash + 1) : targetRef;
};

export const finishMergeBranchResult = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  beforeHead: string,
  output: string,
) => {
  const afterHead = await runGit(runner, workingDirectory, ["rev-parse", "HEAD"]);
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
};

export const mergeConflictOrError = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  commandName: string,
  output: string,
) => {
  const detail = output.length > 0 ? output : `No output from ${commandName}`;
  const conflictedFiles = (await getStatusUnchecked(runner, workingDirectory))
    .filter((statusEntry) => statusEntry.status === "unmerged")
    .map((statusEntry) => statusEntry.path);
  if (conflictedFiles.length > 0) {
    return {
      outcome: "conflicts" as const,
      conflictedFiles,
      output: detail,
    };
  }

  throw new Error(`${commandName} failed: ${detail}`);
};

export const mergeBranchWithCommit = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  sourceBranch: string,
  beforeHead: string,
) => {
  const result = await runGitAllowFailure(runner, workingDirectory, [
    "merge",
    "--no-ff",
    "--end-of-options",
    sourceBranch,
  ]);
  const output = combineOptionalOutput(result.stdout, result.stderr);
  if (!result.ok) {
    return mergeConflictOrError(runner, workingDirectory, "git merge --no-ff", output);
  }

  return finishMergeBranchResult(runner, workingDirectory, beforeHead, output);
};

export const mergeBranchWithSquash = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  sourceBranch: string,
  beforeHead: string,
  squashCommitMessage: string | undefined,
) => {
  const commitMessage = requireNonEmpty(squashCommitMessage ?? "", "squash commit message");
  const result = await runGitAllowFailure(runner, workingDirectory, [
    "merge",
    "--squash",
    "--end-of-options",
    sourceBranch,
  ]);
  const output = combineOptionalOutput(result.stdout, result.stderr);
  if (!result.ok) {
    return mergeConflictOrError(runner, workingDirectory, "git merge --squash", output);
  }

  const staged = await runGitAllowFailure(runner, workingDirectory, [
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

  const commit = await runGitAllowFailure(runner, workingDirectory, [
    "commit",
    "-m",
    commitMessage,
  ]);
  const commitOutput = combineOptionalOutput(commit.stdout, commit.stderr);
  if (!commit.ok) {
    throw new Error(`git commit failed after squash merge: ${commitOutput}`);
  }

  const mergedOutput =
    output.length === 0
      ? commitOutput
      : commitOutput.length === 0
        ? output
        : `${output}\n${commitOutput}`;
  return finishMergeBranchResult(runner, workingDirectory, beforeHead, mergedOutput);
};

export const mergeBranchWithRebase = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  sourceWorkingDirectory: string | undefined,
  sourceBranch: string,
  targetBranch: string,
  beforeHead: string,
) => {
  const rebaseWorkingDirectory = sourceWorkingDirectory ?? workingDirectory;
  const rebase = await runGitAllowFailure(runner, rebaseWorkingDirectory, [
    "rebase",
    "--end-of-options",
    targetBranch,
  ]);
  const rebaseOutput = combineOptionalOutput(rebase.stdout, rebase.stderr);
  if (!rebase.ok) {
    return mergeConflictOrError(runner, rebaseWorkingDirectory, "git rebase", rebaseOutput);
  }

  const fastForward = await runGitAllowFailure(runner, workingDirectory, [
    "merge",
    "--ff-only",
    "--end-of-options",
    sourceBranch,
  ]);
  const fastForwardOutput = combineOptionalOutput(fastForward.stdout, fastForward.stderr);
  if (!fastForward.ok) {
    throw new Error(`git merge --ff-only failed after rebase: ${fastForwardOutput}`);
  }

  const output =
    rebaseOutput.length === 0
      ? fastForwardOutput
      : fastForwardOutput.length === 0
        ? rebaseOutput
        : `${rebaseOutput}\n${fastForwardOutput}`;
  return finishMergeBranchResult(runner, workingDirectory, beforeHead, output);
};

export const mergeBranch = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  request: GitMergeBranchRequest,
) => {
  const sourceBranch = requireNonEmpty(request.sourceBranch, "source branch");
  const targetBranch = requireNonEmpty(request.targetBranch, "target branch");
  const branches = await parseBranchRows(
    await runGit(runner, workingDirectory, [
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
  if ((await getStatusUnchecked(runner, workingDirectory)).length > 0) {
    throw new Error("Cannot merge with uncommitted changes");
  }

  await switchBranch(runner, workingDirectory, checkoutTargetBranch, false);
  const beforeHead = await runGit(runner, workingDirectory, ["rev-parse", "HEAD"]);
  if (request.method === "merge_commit") {
    return mergeBranchWithCommit(runner, workingDirectory, sourceBranch, beforeHead);
  }
  if (request.method === "squash") {
    return mergeBranchWithSquash(
      runner,
      workingDirectory,
      sourceBranch,
      beforeHead,
      request.squashCommitMessage,
    );
  }

  return mergeBranchWithRebase(
    runner,
    workingDirectory,
    request.sourceWorkingDirectory,
    sourceBranch,
    checkoutTargetBranch,
    beforeHead,
  );
};

export const switchBranch = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  branch: string,
  create: boolean,
): Promise<GitCurrentBranch> => {
  const targetBranch = requireNonEmpty(branch, "branch");
  const args = create
    ? ["switch", "-c", targetBranch]
    : ["switch", "--end-of-options", targetBranch];
  await runGit(runner, workingDirectory, args);
  return getCurrentBranchUnchecked(runner, workingDirectory);
};
