import { readFile } from "node:fs/promises";
import type { FileStatus, GitCurrentBranch } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  HostOperationError,
  HostResourceError,
  HostValidationError,
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
const rebaseConflictOutputUnavailable =
  "Git conflict is still in progress in this worktree. Previous command output is unavailable after reload.";
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
const matchesRemoteBranchName = (remoteRef: string, branch: string): boolean => {
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
      return yield* Effect.fail(
        gitOperationError(
          `Failed to list remote refs while resolving upstream for branch ${branch}: ${combineOutput(result.stdout, result.stderr)}`,
          "git.for-each-ref",
        ),
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
export const resolveTrackedUpstreamReference = (
  runner: GitCommandRunner,
  workingDirectory: string,
  branch: string | undefined,
) =>
  Effect.gen(function* () {
    if (!branch) return undefined;
    const ref = (yield* runGit(runner, workingDirectory, [
      "for-each-ref",
      "--format=%(upstream)",
      `refs/heads/${branch}`,
    ])).trim();
    return ref || undefined;
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
    return yield* Effect.try({
      try: () => parseAheadBehind(output),
      catch: (cause) =>
        cause instanceof HostValidationError
          ? cause
          : gitOperationError(String(cause), "git.parse-ahead-behind"),
    });
  });
/**
 * The commits that no remote has, so the first push of the branch sends them. An unborn branch
 * has none.
 */
const countUnpublishedCommits = (
  runner: GitCommandRunner,
  workingDirectory: string,
  headRevision: string | undefined,
) =>
  Effect.gen(function* () {
    if (!headRevision) return 0;
    // The revision is an object ID from a Git read, so it cannot read as an option.
    const output = yield* runGit(runner, workingDirectory, [
      "rev-list",
      "--count",
      headRevision,
      "--not",
      "--remotes",
    ]);
    const text = output.trim();
    const count = Number(text);
    if (!Number.isInteger(count)) {
      return yield* gitOperationError(
        `Git returned an invalid commit count: ${text}`,
        "git.rev-list",
      );
    }
    return count;
  });

/**
 * The upstream counts of a branch. A branch without a remote branch yet is untracked, and its
 * `ahead` count holds the commits that its first push sends.
 */
export const resolveUpstreamAheadBehind = (
  runner: GitCommandRunner,
  workingDirectory: string,
  upstreamTarget: string | undefined,
  headRevision: string | undefined,
) =>
  Effect.gen(function* () {
    const untracked = Effect.map(
      countUnpublishedCommits(runner, workingDirectory, headRevision),
      (ahead) => ({ outcome: "untracked" as const, ahead }),
    );
    if (!upstreamTarget) return yield* untracked;
    const ref = yield* runGitAllowFailure(runner, workingDirectory, [
      "show-ref",
      "--verify",
      "--quiet",
      upstreamTarget,
    ]);
    // A new task branch can have tracking settings before its first push.
    if (!ref.ok && ref.exitCode === 1 && upstreamTarget.startsWith("refs/remotes/")) {
      return yield* untracked;
    }
    if (!ref.ok) {
      return yield* gitOperationError(
        `Cannot read upstream ${upstreamTarget}: ${combineOutput(ref.stdout, ref.stderr)}`,
        "git.show-ref",
      );
    }
    const counts = yield* commitsAgainstTargetOrDefault(runner, workingDirectory, upstreamTarget);
    return { outcome: "tracking" as const, ahead: counts.ahead, behind: counts.behind };
  }).pipe(
    // The panel shows an upstream failure on its own, so the rest of the read still shows.
    Effect.catch((error) =>
      Effect.succeed({
        outcome: "error" as const,
        message: error instanceof Error ? error.message : String(error),
      }),
    ),
  );
const resolveGitPath = (runner: GitCommandRunner, workingDirectory: string, suffix: string) =>
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
      return yield* Effect.fail(
        gitResourceError(
          `git rev-parse --git-path ${suffix} returned no path`,
          "git.rev-parse.git-path",
          suffix,
        ),
      );
    }
    return gitPath;
  });
const readGitPathContentsIfExists = (
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
const hasGitPath = (runner: GitCommandRunner, workingDirectory: string, suffix: string) =>
  Effect.gen(function* () {
    return yield* pathExists(yield* resolveGitPath(runner, workingDirectory, suffix));
  });
const normalizeHeadName = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.startsWith("refs/heads/") ? trimmed.slice("refs/heads/".length) : trimmed;
};
/**
 * The branch that a rebase in progress rewrites, or undefined when no rebase runs. Git detaches
 * HEAD during a rebase and records the branch in `head-name`.
 */
export const readRebasingBranch = (runner: GitCommandRunner, workingDirectory: string) =>
  Effect.gen(function* () {
    for (const directory of ["rebase-merge", "rebase-apply"]) {
      const headName = yield* readGitPathContentsIfExists(
        runner,
        workingDirectory,
        `${directory}/head-name`,
      );
      if (headName?.startsWith("refs/heads/")) return headName.slice("refs/heads/".length);
    }
    return undefined;
  });
export const loadRebaseConflictContext = (
  runner: GitCommandRunner,
  workingDirectory: string,
  currentBranch: GitCurrentBranch,
  fileStatuses: FileStatus[],
) =>
  Effect.gen(function* () {
    const conflictedFiles = fileStatuses
      .filter((statusEntry) => statusEntry.status === "unmerged")
      .map((statusEntry) => statusEntry.path);
    if (conflictedFiles.length === 0) {
      return undefined;
    }
    let directory: string;
    if (yield* hasGitPath(runner, workingDirectory, "rebase-merge")) directory = "rebase-merge";
    else if (yield* hasGitPath(runner, workingDirectory, "rebase-apply"))
      directory = "rebase-apply";
    else return undefined;
    const headName = yield* readGitPathContentsIfExists(
      runner,
      workingDirectory,
      `${directory}/head-name`,
    );
    // The diff target can be HEAD. Git records the actual rebase destination in onto.
    const targetBranch = yield* readGitPathContentsIfExists(
      runner,
      workingDirectory,
      `${directory}/onto`,
    );
    if (!targetBranch)
      return yield* gitOperationError(
        "Cannot restore the rebase destination: Git rebase metadata has no onto commit.",
        "git.rebase.context",
      );
    const currentBranchName = currentBranch.name ?? normalizeHeadName(headName);
    const statusOutput = yield* runGitAllowFailure(runner, workingDirectory, [
      "status",
      "--untracked-files=no",
    ]).pipe(
      Effect.map((result) => combineOutput(result.stdout, result.stderr)),
      Effect.catch(() => Effect.succeed(rebaseConflictOutputUnavailable)),
    );
    return {
      operation: "rebase" as const,
      currentBranch: currentBranchName,
      targetBranch,
      conflictedFiles,
      output: statusOutput.trim() ? statusOutput : rebaseConflictOutputUnavailable,
    };
  });
