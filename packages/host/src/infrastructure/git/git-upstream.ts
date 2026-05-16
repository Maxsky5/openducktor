import { readFile } from "node:fs/promises";
import type { CommitsAheadBehind, FileStatus, GitCurrentBranch } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  HostOperationError,
  HostResourceError,
  toHostOperationError,
} from "../../effect/host-errors";
import {
  combineOutput,
  type GitCommandRunner,
  pathExists,
  runGit,
  runGitAllowFailure,
} from "./git-command-runner";
import { parseAheadBehind } from "./git-status";

const gitOperationError = (message: string, operation: string): HostOperationError =>
  new HostOperationError({ message, operation });
const gitResourceError = (
  message: string,
  operation: string,
  resource: string,
): HostResourceError => new HostResourceError({ message, operation, resource });
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
export const resolveFallbackRemoteRefForBranch = (
  runner: GitCommandRunner,
  workingDirectory: string,
  branch: string,
) =>
  Effect.gen(function* () {
    const result = yield* runGitAllowFailure(runner, workingDirectory, [
      "for-each-ref",
      "--format=%(refname)",
      "refs/remotes",
    ]);
    if (!result.ok) {
      throw gitOperationError(
        `Failed to list remote refs while resolving upstream for branch ${branch}: ${combineOutput(result.stdout, result.stderr)}`,
        "git.for-each-ref",
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
  });
export const resolveUpstreamTargetForBranch = (
  runner: GitCommandRunner,
  workingDirectory: string,
  branchName: string | undefined,
) =>
  Effect.gen(function* () {
    if (!branchName) {
      return undefined;
    }
    const remoteResult = yield* runGitAllowFailure(runner, workingDirectory, [
      "config",
      "--get",
      `branch.${branchName}.remote`,
    ]);
    if (!remoteResult.ok || !remoteResult.stdout.trim()) {
      return yield* resolveFallbackRemoteRefForBranch(runner, workingDirectory, branchName);
    }
    const mergeResult = yield* runGitAllowFailure(runner, workingDirectory, [
      "config",
      "--get",
      `branch.${branchName}.merge`,
    ]);
    if (!mergeResult.ok || !mergeResult.stdout.trim()) {
      return yield* resolveFallbackRemoteRefForBranch(runner, workingDirectory, branchName);
    }
    const upstreamRef = resolveUpstreamRef(remoteResult.stdout.trim(), mergeResult.stdout.trim());
    const existsResult = yield* runGitAllowFailure(runner, workingDirectory, [
      "show-ref",
      "--verify",
      "--quiet",
      upstreamRef,
    ]);
    if (!existsResult.ok) {
      return yield* resolveFallbackRemoteRefForBranch(runner, workingDirectory, branchName);
    }
    return upstreamRef;
  });
export const resolveUpstreamTargetConfigForBranch = (
  runner: GitCommandRunner,
  workingDirectory: string,
  branchName: string | undefined,
) =>
  Effect.gen(function* () {
    if (!branchName) {
      return undefined;
    }
    const remoteResult = yield* runGitAllowFailure(runner, workingDirectory, [
      "config",
      "--get",
      `branch.${branchName}.remote`,
    ]);
    if (!remoteResult.ok || !remoteResult.stdout.trim()) {
      return undefined;
    }
    const mergeResult = yield* runGitAllowFailure(runner, workingDirectory, [
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
  });
export const resolveEffectiveTargetBranch = (
  requestedTargetBranch: string,
  upstreamTarget: string | undefined,
): string | undefined => {
  if (requestedTargetBranch === upstreamTargetBranch) {
    return upstreamTarget;
  }
  return requestedTargetBranch;
};
export const commitsAgainstTargetOrDefault = (
  runner: GitCommandRunner,
  workingDirectory: string,
  targetBranch: string | undefined,
) =>
  Effect.gen(function* () {
    if (!targetBranch) {
      return { ahead: 0, behind: 0 };
    }
    const range = `${targetBranch}...HEAD`;
    const output = yield* runGit(runner, workingDirectory, [
      "rev-list",
      "--count",
      "--left-right",
      "--end-of-options",
      range,
    ]);
    return parseAheadBehind(output);
  });
export const resolveUpstreamAheadBehind = (
  runner: GitCommandRunner,
  workingDirectory: string,
  upstreamTarget: string | undefined,
  targetAheadBehind: CommitsAheadBehind,
) =>
  Effect.gen(function* () {
    if (!upstreamTarget) {
      return { outcome: "untracked" as const, ahead: targetAheadBehind.ahead };
    }
    const result = yield* commitsAgainstTargetOrDefault(
      runner,
      workingDirectory,
      upstreamTarget,
    ).pipe(
      Effect.map((counts) => ({ outcome: "counts" as const, counts })),
      Effect.catchAll((error) =>
        Effect.succeed({
          outcome: "error" as const,
          message: error instanceof Error ? error.message : String(error),
        }),
      ),
    );
    if (result.outcome === "error") {
      return result;
    }
    return {
      outcome: "tracking" as const,
      ahead: result.counts.ahead,
      behind: result.counts.behind,
    };
  });
export const resolveGitPath = (
  runner: GitCommandRunner,
  workingDirectory: string,
  suffix: string,
) =>
  Effect.gen(function* () {
    const output = yield* runGit(runner, workingDirectory, [
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
      throw gitResourceError(
        `git rev-parse --git-path ${suffix} returned no path`,
        "git.rev-parse.git-path",
        suffix,
      );
    }
    return gitPath;
  });
export const readGitPathContentsIfExists = (
  runner: GitCommandRunner,
  workingDirectory: string,
  suffix: string,
) =>
  Effect.gen(function* () {
    const gitPath = yield* resolveGitPath(runner, workingDirectory, suffix);
    if (!(yield* pathExists(gitPath))) {
      return undefined;
    }
    const contents = yield* Effect.tryPromise({
      try: () => readFile(gitPath, "utf8"),
      catch: (cause) => toHostOperationError(cause, "git.readGitPathContentsIfExists.readFile"),
    });
    const trimmed = contents.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  });
export const hasGitPath = (runner: GitCommandRunner, workingDirectory: string, suffix: string) =>
  Effect.gen(function* () {
    return yield* pathExists(yield* resolveGitPath(runner, workingDirectory, suffix));
  });
export const normalizeHeadName = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.startsWith("refs/heads/") ? trimmed.slice("refs/heads/".length) : trimmed;
};
export const loadRebaseConflictContext = (
  runner: GitCommandRunner,
  workingDirectory: string,
  currentBranch: GitCurrentBranch,
  fallbackTargetBranch: string | undefined,
  fileStatuses: FileStatus[],
) =>
  Effect.gen(function* () {
    const conflictedFiles = fileStatuses
      .filter((statusEntry) => statusEntry.status === "unmerged")
      .map((statusEntry) => statusEntry.path);
    if (conflictedFiles.length === 0) {
      return undefined;
    }
    const isRebaseInProgress =
      (yield* hasGitPath(runner, workingDirectory, "rebase-merge")) ||
      (yield* hasGitPath(runner, workingDirectory, "rebase-apply"));
    if (!isRebaseInProgress) {
      return undefined;
    }
    const mergeHeadName = yield* readGitPathContentsIfExists(
      runner,
      workingDirectory,
      "rebase-merge/head-name",
    );
    const applyHeadName = yield* readGitPathContentsIfExists(
      runner,
      workingDirectory,
      "rebase-apply/head-name",
    );
    const currentBranchName =
      currentBranch.name ?? normalizeHeadName(mergeHeadName) ?? normalizeHeadName(applyHeadName);
    const statusOutput = yield* runGitAllowFailure(runner, workingDirectory, [
      "status",
      "--untracked-files=no",
    ]).pipe(
      Effect.map((result) => combineOutput(result.stdout, result.stderr)),
      Effect.catchAll(() => Effect.succeed(rebaseConflictOutputUnavailable)),
    );
    return {
      operation: "rebase" as const,
      currentBranch: currentBranchName,
      targetBranch: fallbackTargetBranch ?? rebaseConflictTargetUnavailable,
      conflictedFiles,
      output: statusOutput.trim() ? statusOutput : rebaseConflictOutputUnavailable,
    };
  });
