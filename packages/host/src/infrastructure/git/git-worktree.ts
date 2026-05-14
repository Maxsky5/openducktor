import type { GitBranchUpstreamSetup } from "../../ports/git-port";
import {
  combineOutput,
  type GitCommandRunner,
  referenceExists,
  requireNonEmpty,
  runGit,
  runGitAllowFailure,
} from "./git-command-runner";

export const createWorktree = async (
  runner: GitCommandRunner,
  repoPath: string,
  worktreePath: string,
  branch: string,
  createBranch: boolean,
  startPoint?: string,
): Promise<void> => {
  const targetBranch = requireNonEmpty(branch, "branch");
  const targetWorktreePath = requireNonEmpty(worktreePath, "worktree path");
  const args = createBranch
    ? [
        "worktree",
        "add",
        "-b",
        targetBranch,
        "--end-of-options",
        targetWorktreePath,
        ...(startPoint ? [requireNonEmpty(startPoint, "start point")] : []),
      ]
    : ["worktree", "add", "--end-of-options", targetWorktreePath, targetBranch];

  await runGit(runner, repoPath, args);
};

export const deleteReference = async (
  runner: GitCommandRunner,
  repoPath: string,
  reference: string,
): Promise<void> => {
  await runGit(runner, repoPath, ["update-ref", "-d", requireNonEmpty(reference, "reference")]);
};

export const collectFailedBranchConfigCleanup = async (
  runner: GitCommandRunner,
  repoPath: string,
  keys: string[],
  cleanupErrors: string[],
): Promise<void> => {
  for (const key of keys) {
    const result = await runGitAllowFailure(runner, repoPath, ["config", "--unset-all", key]);
    if (!result.ok) {
      cleanupErrors.push(
        `Also failed to unset git config ${key}: ${combineOutput(result.stdout, result.stderr)}`,
      );
    }
  }
};

export const formatCleanupErrors = (cleanupErrors: string[]): string =>
  cleanupErrors.length === 0 ? "" : `\n${cleanupErrors.join("\n")}`;

export const cleanupFailedUpstreamSetup = async (
  runner: GitCommandRunner,
  repoPath: string,
  branchRemoteKey: string,
  branchMergeKey: string | null,
  createdTrackingRef: string | null,
): Promise<string> => {
  const cleanupErrors: string[] = [];
  if (createdTrackingRef) {
    const result = await runGitAllowFailure(runner, repoPath, [
      "update-ref",
      "-d",
      createdTrackingRef,
    ]);
    if (!result.ok) {
      cleanupErrors.push(
        `Also failed to delete created upstream tracking ref ${createdTrackingRef}: ${combineOutput(result.stdout, result.stderr)}`,
      );
    }
  }
  await collectFailedBranchConfigCleanup(
    runner,
    repoPath,
    [branchRemoteKey, ...(branchMergeKey ? [branchMergeKey] : [])],
    cleanupErrors,
  );
  return formatCleanupErrors(cleanupErrors);
};

export const configureBranchUpstream = async (
  runner: GitCommandRunner,
  repoPath: string,
  worktreePath: string,
  branch: string,
  upstreamRemote: string,
): Promise<GitBranchUpstreamSetup> => {
  const targetBranch = requireNonEmpty(branch, "branch");
  const remote = requireNonEmpty(upstreamRemote, "upstream remote");
  const branchRemoteKey = `branch.${targetBranch}.remote`;
  const branchMergeKey = `branch.${targetBranch}.merge`;
  const localBranchRef = `refs/heads/${targetBranch}`;
  const trackingRef = `refs/remotes/${remote}/${targetBranch}`;
  const expectedUpstream = `${remote}/${targetBranch}`;

  await runGit(runner, repoPath, ["config", branchRemoteKey, remote]);
  try {
    await runGit(runner, repoPath, ["config", branchMergeKey, localBranchRef]);
  } catch (error) {
    const cleanupError = await cleanupFailedUpstreamSetup(
      runner,
      repoPath,
      branchRemoteKey,
      null,
      null,
    );
    throw new Error(
      `Failed configuring upstream merge for build worktree branch ${targetBranch}: ${String(error)}${cleanupError}`,
      { cause: error },
    );
  }

  const trackingRefAlreadyExists = await referenceExists(runner, repoPath, trackingRef);
  let createdTrackingRef: string | null = null;
  if (!trackingRefAlreadyExists) {
    try {
      const localBranchOid = (await runGit(runner, repoPath, ["rev-parse", localBranchRef])).trim();
      if (!localBranchOid) {
        throw new Error(`git rev-parse returned an empty revision for ${localBranchRef}`);
      }
      await runGit(runner, repoPath, ["update-ref", trackingRef, localBranchOid]);
      createdTrackingRef = trackingRef;
    } catch (error) {
      const cleanupError = await cleanupFailedUpstreamSetup(
        runner,
        repoPath,
        branchRemoteKey,
        branchMergeKey,
        null,
      );
      throw new Error(
        `Failed creating upstream tracking ref ${trackingRef} for build worktree branch ${targetBranch}: ${String(error)}${cleanupError}`,
        { cause: error },
      );
    }
  }

  try {
    const resolvedUpstream = (
      await runGit(runner, worktreePath, [
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{upstream}",
      ])
    ).trim();
    if (resolvedUpstream !== expectedUpstream) {
      const cleanupError = await cleanupFailedUpstreamSetup(
        runner,
        repoPath,
        branchRemoteKey,
        branchMergeKey,
        createdTrackingRef,
      );
      throw new Error(
        `configured upstream resolved to ${resolvedUpstream}, expected ${expectedUpstream}${cleanupError}`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("configured upstream resolved to ")) {
      throw error;
    }
    const cleanupError = await cleanupFailedUpstreamSetup(
      runner,
      repoPath,
      branchRemoteKey,
      branchMergeKey,
      createdTrackingRef,
    );
    throw new Error(
      `Failed verifying upstream tracking for build worktree branch ${targetBranch}: ${String(error)}${cleanupError}`,
      { cause: error },
    );
  }

  return { createdTrackingRef };
};

export const removeWorktree = async (
  runner: GitCommandRunner,
  repoPath: string,
  worktreePath: string,
  force: boolean,
): Promise<void> => {
  const targetWorktreePath = requireNonEmpty(worktreePath, "worktree path");
  const args = ["worktree", "remove"];
  if (force) {
    args.push("--force");
  }
  args.push("--end-of-options", targetWorktreePath);

  await runGit(runner, repoPath, args);
};

export const deleteLocalBranch = async (
  runner: GitCommandRunner,
  repoPath: string,
  branch: string,
  force: boolean,
): Promise<void> => {
  const targetBranch = requireNonEmpty(branch, "branch");
  await runGit(runner, repoPath, ["branch", force ? "-D" : "-d", "--end-of-options", targetBranch]);
};
