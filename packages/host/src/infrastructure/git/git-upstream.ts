import { readFile } from "node:fs/promises";
import type {
  CommitsAheadBehind,
  FileStatus,
  GitConflict,
  GitCurrentBranch,
  GitUpstreamAheadBehind,
} from "@openducktor/contracts";
import {
  combineOutput,
  type GitCommandRunner,
  pathExists,
  runGit,
  runGitAllowFailure,
} from "./git-command-runner";
import { parseAheadBehind } from "./git-status";

export const upstreamTargetBranch = "@{upstream}";
export const emptyTreeSha1 = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
export const emptyTreeSha256 = "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321";
export const rebaseConflictOutputUnavailable =
  "Git conflict is still in progress in this worktree. Previous command output is unavailable after reload.";
export const rebaseConflictTargetUnavailable = "current rebase target";

export const normalizeMergeRef = (mergeRef: string): string =>
  mergeRef.startsWith("refs/") ? mergeRef : `refs/heads/${mergeRef}`;

export type UpstreamTargetConfig = {
  remote: string;
  mergeRef: string;
  upstreamRef: string;
};

export const resolveUpstreamRef = (remote: string, mergeRef: string): string => {
  const normalizedMerge = normalizeMergeRef(mergeRef);
  if (remote === ".") {
    return normalizedMerge;
  }

  const branchRef = normalizedMerge.startsWith("refs/heads/")
    ? normalizedMerge.slice("refs/heads/".length)
    : normalizedMerge;
  return `refs/remotes/${remote}/${branchRef}`;
};

export const matchesRemoteBranchName = (remoteRef: string, branch: string): boolean => {
  const remainder = remoteRef.startsWith("refs/remotes/")
    ? remoteRef.slice("refs/remotes/".length)
    : undefined;
  if (!remainder) {
    return false;
  }

  const slash = remainder.indexOf("/");
  if (slash < 0) {
    return false;
  }

  return remainder.slice(slash + 1) === branch;
};

export const resolveFallbackRemoteRefForBranch = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  branch: string,
): Promise<string | undefined> => {
  const result = await runGitAllowFailure(runner, workingDirectory, [
    "for-each-ref",
    "--format=%(refname)",
    "refs/remotes",
  ]);
  if (!result.ok) {
    throw new Error(
      `Failed to list remote refs while resolving upstream for branch ${branch}: ${combineOutput(
        result.stdout,
        result.stderr,
      )}`,
    );
  }

  const matches = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => matchesRemoteBranchName(line, branch));
  if (matches.length === 0) {
    return undefined;
  }

  const preferredOriginRef = `refs/remotes/origin/${branch}`;
  if (matches.includes(preferredOriginRef)) {
    return preferredOriginRef;
  }

  return matches.length === 1 ? matches[0] : undefined;
};

export const resolveUpstreamTargetForBranch = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  branchName: string | undefined,
): Promise<string | undefined> => {
  if (!branchName) {
    return undefined;
  }

  const remoteResult = await runGitAllowFailure(runner, workingDirectory, [
    "config",
    "--get",
    `branch.${branchName}.remote`,
  ]);
  if (!remoteResult.ok || !remoteResult.stdout.trim()) {
    return resolveFallbackRemoteRefForBranch(runner, workingDirectory, branchName);
  }

  const mergeResult = await runGitAllowFailure(runner, workingDirectory, [
    "config",
    "--get",
    `branch.${branchName}.merge`,
  ]);
  if (!mergeResult.ok || !mergeResult.stdout.trim()) {
    return resolveFallbackRemoteRefForBranch(runner, workingDirectory, branchName);
  }

  const upstreamRef = resolveUpstreamRef(remoteResult.stdout.trim(), mergeResult.stdout.trim());
  const existsResult = await runGitAllowFailure(runner, workingDirectory, [
    "show-ref",
    "--verify",
    "--quiet",
    upstreamRef,
  ]);
  if (!existsResult.ok) {
    return resolveFallbackRemoteRefForBranch(runner, workingDirectory, branchName);
  }

  return upstreamRef;
};

export const resolveUpstreamTargetConfigForBranch = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  branchName: string | undefined,
): Promise<UpstreamTargetConfig | undefined> => {
  if (!branchName) {
    return undefined;
  }

  const remoteResult = await runGitAllowFailure(runner, workingDirectory, [
    "config",
    "--get",
    `branch.${branchName}.remote`,
  ]);
  if (!remoteResult.ok || !remoteResult.stdout.trim()) {
    return undefined;
  }

  const mergeResult = await runGitAllowFailure(runner, workingDirectory, [
    "config",
    "--get",
    `branch.${branchName}.merge`,
  ]);
  if (!mergeResult.ok || !mergeResult.stdout.trim()) {
    return undefined;
  }

  const remote = remoteResult.stdout.trim();
  const mergeRef = normalizeMergeRef(mergeResult.stdout.trim());
  return {
    remote,
    mergeRef,
    upstreamRef: resolveUpstreamRef(remote, mergeRef),
  };
};

export const resolveEffectiveTargetBranch = (
  requestedTargetBranch: string,
  upstreamTarget: string | undefined,
): string | undefined => {
  if (requestedTargetBranch === upstreamTargetBranch) {
    return upstreamTarget;
  }

  return requestedTargetBranch;
};

export const commitsAgainstTargetOrDefault = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  targetBranch: string | undefined,
): Promise<CommitsAheadBehind> => {
  if (!targetBranch) {
    return { ahead: 0, behind: 0 };
  }

  const range = `${targetBranch}...HEAD`;
  const output = await runGit(runner, workingDirectory, [
    "rev-list",
    "--count",
    "--left-right",
    "--end-of-options",
    range,
  ]);
  return parseAheadBehind(output);
};

export const resolveUpstreamAheadBehind = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  upstreamTarget: string | undefined,
  targetAheadBehind: CommitsAheadBehind,
): Promise<GitUpstreamAheadBehind> => {
  if (!upstreamTarget) {
    return { outcome: "untracked", ahead: targetAheadBehind.ahead };
  }

  try {
    const counts = await commitsAgainstTargetOrDefault(runner, workingDirectory, upstreamTarget);
    return { outcome: "tracking", ahead: counts.ahead, behind: counts.behind };
  } catch (error) {
    return { outcome: "error", message: error instanceof Error ? error.message : String(error) };
  }
};

export const resolveGitPath = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  suffix: string,
): Promise<string> => {
  const output = await runGit(runner, workingDirectory, [
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    suffix,
  ]);
  const gitPath = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!gitPath) {
    throw new Error(`git rev-parse --git-path ${suffix} returned no path`);
  }

  return gitPath;
};

export const readGitPathContentsIfExists = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  suffix: string,
): Promise<string | undefined> => {
  const gitPath = await resolveGitPath(runner, workingDirectory, suffix);
  if (!(await pathExists(gitPath))) {
    return undefined;
  }

  const contents = await readFile(gitPath, "utf8");
  const trimmed = contents.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const hasGitPath = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  suffix: string,
): Promise<boolean> => pathExists(await resolveGitPath(runner, workingDirectory, suffix));

export const normalizeHeadName = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.startsWith("refs/heads/") ? trimmed.slice("refs/heads/".length) : trimmed;
};

export const loadRebaseConflictContext = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  currentBranch: GitCurrentBranch,
  fallbackTargetBranch: string | undefined,
  fileStatuses: FileStatus[],
): Promise<GitConflict | undefined> => {
  const conflictedFiles = fileStatuses
    .filter((statusEntry) => statusEntry.status === "unmerged")
    .map((statusEntry) => statusEntry.path);
  if (conflictedFiles.length === 0) {
    return undefined;
  }

  const isRebaseInProgress =
    (await hasGitPath(runner, workingDirectory, "rebase-merge")) ||
    (await hasGitPath(runner, workingDirectory, "rebase-apply"));
  if (!isRebaseInProgress) {
    return undefined;
  }

  const mergeHeadName = await readGitPathContentsIfExists(
    runner,
    workingDirectory,
    "rebase-merge/head-name",
  );
  const applyHeadName = await readGitPathContentsIfExists(
    runner,
    workingDirectory,
    "rebase-apply/head-name",
  );
  const currentBranchName =
    currentBranch.name ?? normalizeHeadName(mergeHeadName) ?? normalizeHeadName(applyHeadName);
  const statusOutput = await runGitAllowFailure(runner, workingDirectory, [
    "status",
    "--untracked-files=no",
  ])
    .then((result) => combineOutput(result.stdout, result.stderr))
    .catch(() => rebaseConflictOutputUnavailable);

  return {
    operation: "rebase",
    currentBranch: currentBranchName,
    targetBranch: fallbackTargetBranch ?? rebaseConflictTargetUnavailable,
    conflictedFiles,
    output: statusOutput.trim() ? statusOutput : rebaseConflictOutputUnavailable,
  };
};
