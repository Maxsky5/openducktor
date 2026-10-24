import { Effect } from "effect";
import { type CanonicalPathPlatform, canonicalPathsEqual } from "../../domain/path-comparison";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { GitWorktreeEntry } from "../../ports/git-port";
import { isAncestor } from "./git-merge";
import {
  combineOutput,
  type GitCommandRunner,
  realPathIfPresent,
  referenceExists,
  requireNonEmptyEffect,
  runGit,
  runGitAllowFailure,
} from "./git-command-runner";

const HOST_PATH_PLATFORM: CanonicalPathPlatform =
  process.platform === "win32" ? "windows" : "posix";

const gitOperationError = (
  message: string,
  operation: string,
  cause?: unknown,
): HostOperationError => new HostOperationError({ message, operation, cause });
const gitValidationError = (message: string, field: string): HostValidationError =>
  new HostValidationError({ message, field });
export const createWorktree = (
  runner: GitCommandRunner,
  repoPath: string,
  worktreePath: string,
  branch: string,
  createBranch: boolean,
  startPoint?: string,
) =>
  Effect.gen(function* () {
    const targetBranch = yield* requireNonEmptyEffect(branch, "branch");
    const targetWorktreePath = yield* requireNonEmptyEffect(worktreePath, "worktree path");
    const normalizedStartPoint = startPoint
      ? yield* requireNonEmptyEffect(startPoint, "start point")
      : undefined;
    const args = createBranch
      ? [
          "worktree",
          "add",
          "-b",
          targetBranch,
          "--end-of-options",
          targetWorktreePath,
          ...(normalizedStartPoint ? [normalizedStartPoint] : []),
        ]
      : ["worktree", "add", "--end-of-options", targetWorktreePath, targetBranch];
    yield* runGit(runner, repoPath, args);
  });

export const listWorktrees = (runner: GitCommandRunner, repoPath: string) =>
  Effect.gen(function* () {
    const output = yield* runGit(runner, repoPath, ["worktree", "list", "--porcelain", "-z"]);
    const worktrees: GitWorktreeEntry[] = [];
    let currentPath: string | null = null;
    let currentBranch: string | null = null;
    const flush = (): void => {
      if (currentPath !== null) {
        worktrees.push({ branch: currentBranch, worktreePath: currentPath });
      }
      currentPath = null;
      currentBranch = null;
    };

    for (const entry of output.split("\0")) {
      if (entry.startsWith("worktree ")) {
        flush();
        currentPath = entry.slice("worktree ".length);
        continue;
      }
      if (currentPath === null) {
        continue;
      }
      // A detached HEAD has no branch line, so its branch stays null.
      if (entry.startsWith("branch ")) {
        currentBranch = entry.slice("branch ".length).replace(/^refs\/heads\//, "");
      }
    }
    flush();
    return worktrees;
  });

/** Folds the letter case and Unicode form that a macOS file system ignores in a path. */
const foldPath = (value: string) => value.normalize("NFC").toLowerCase();

/**
 * Checks a path against a worktree list. Git keeps a path as the user typed it, so on macOS its
 * letter case or Unicode form can differ from the real path of the same directory. Only an entry
 * that folds to the same path can be that directory, so only such an entry gets a real path read.
 */
export const isListedWorktreePath = (
  worktrees: readonly GitWorktreeEntry[],
  worktreePath: string,
) =>
  Effect.gen(function* () {
    if (
      worktrees.some((entry) =>
        canonicalPathsEqual(entry.worktreePath, worktreePath, HOST_PATH_PLATFORM),
      )
    )
      return true;
    const folded = foldPath(worktreePath);
    const candidates = worktrees.filter((entry) => foldPath(entry.worktreePath) === folded);
    if (candidates.length === 0) return false;
    const realPath = yield* realPathIfPresent(worktreePath);
    if (realPath === null) return false;
    for (const entry of candidates) {
      if ((yield* realPathIfPresent(entry.worktreePath)) === realPath) return true;
    }
    return false;
  });
export const deleteReference = (runner: GitCommandRunner, repoPath: string, reference: string) =>
  Effect.gen(function* () {
    const targetReference = yield* requireNonEmptyEffect(reference, "reference");
    yield* runGit(runner, repoPath, ["update-ref", "-d", targetReference]);
  });
const collectFailedBranchConfigCleanup = (
  runner: GitCommandRunner,
  repoPath: string,
  keys: string[],
  cleanupErrors: string[],
) =>
  Effect.gen(function* () {
    for (const key of keys) {
      const result = yield* runGitAllowFailure(runner, repoPath, ["config", "--unset-all", key]);
      if (!result.ok) {
        cleanupErrors.push(
          `Also failed to unset git config ${key}: ${combineOutput(result.stdout, result.stderr)}`,
        );
      }
    }
  });
const formatCleanupErrors = (cleanupErrors: string[]): string =>
  cleanupErrors.length === 0 ? "" : `\n${cleanupErrors.join("\n")}`;
const cleanupFailedUpstreamSetup = (
  runner: GitCommandRunner,
  repoPath: string,
  branchRemoteKey: string,
  branchMergeKey: string | null,
  createdTrackingRef: string | null,
) =>
  Effect.gen(function* () {
    const cleanupErrors: string[] = [];
    if (createdTrackingRef) {
      const result = yield* runGitAllowFailure(runner, repoPath, [
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
    yield* collectFailedBranchConfigCleanup(
      runner,
      repoPath,
      [branchRemoteKey, ...(branchMergeKey ? [branchMergeKey] : [])],
      cleanupErrors,
    );
    return formatCleanupErrors(cleanupErrors);
  });
export const configureBranchUpstream = (
  runner: GitCommandRunner,
  repoPath: string,
  worktreePath: string,
  branch: string,
  upstreamRemote: string,
) =>
  Effect.gen(function* () {
    const targetBranch = yield* requireNonEmptyEffect(branch, "branch");
    const remote = yield* requireNonEmptyEffect(upstreamRemote, "upstream remote");
    const branchRemoteKey = `branch.${targetBranch}.remote`;
    const branchMergeKey = `branch.${targetBranch}.merge`;
    const localBranchRef = `refs/heads/${targetBranch}`;
    const trackingRef = `refs/remotes/${remote}/${targetBranch}`;
    const expectedUpstream = `${remote}/${targetBranch}`;
    yield* runGit(runner, repoPath, ["config", branchRemoteKey, remote]);
    const mergeConfigResult = yield* runGit(runner, repoPath, [
      "config",
      branchMergeKey,
      localBranchRef,
    ]).pipe(Effect.result);
    if (mergeConfigResult._tag === "Failure") {
      const error = mergeConfigResult.failure;
      const cleanupError = yield* cleanupFailedUpstreamSetup(
        runner,
        repoPath,
        branchRemoteKey,
        null,
        null,
      );
      return yield* Effect.fail(
        gitOperationError(
          `Failed configuring upstream merge for task worktree branch ${targetBranch}: ${String(error)}${cleanupError}`,
          "git.config.upstream-merge",
          error,
        ),
      );
    }
    const trackingRefAlreadyExists = yield* referenceExists(runner, repoPath, trackingRef);
    let createdTrackingRef: string | null = null;
    if (!trackingRefAlreadyExists) {
      const trackingResult = yield* Effect.gen(function* () {
        const localBranchOid = (yield* runGit(runner, repoPath, [
          "rev-parse",
          localBranchRef,
        ])).trim();
        if (!localBranchOid) {
          return yield* Effect.fail(
            gitValidationError(
              `git rev-parse returned an empty revision for ${localBranchRef}`,
              "revision",
            ),
          );
        }
        yield* runGit(runner, repoPath, ["update-ref", trackingRef, localBranchOid]);
        createdTrackingRef = trackingRef;
      }).pipe(Effect.result);
      if (trackingResult._tag === "Failure") {
        const error = trackingResult.failure;
        const cleanupError = yield* cleanupFailedUpstreamSetup(
          runner,
          repoPath,
          branchRemoteKey,
          branchMergeKey,
          null,
        );
        return yield* Effect.fail(
          gitOperationError(
            `Failed creating upstream tracking ref ${trackingRef} for task worktree branch ${targetBranch}: ${String(error)}${cleanupError}`,
            "git.update-ref.upstream-tracking",
            error,
          ),
        );
      }
    }
    const verifyResult = yield* Effect.gen(function* () {
      const resolvedUpstream = (yield* runGit(runner, worktreePath, [
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{upstream}",
      ])).trim();
      if (resolvedUpstream !== expectedUpstream) {
        const cleanupError = yield* cleanupFailedUpstreamSetup(
          runner,
          repoPath,
          branchRemoteKey,
          branchMergeKey,
          createdTrackingRef,
        );
        return yield* Effect.fail(
          gitValidationError(
            `configured upstream resolved to ${resolvedUpstream}, expected ${expectedUpstream}${cleanupError}`,
            "upstream",
          ),
        );
      }
    }).pipe(Effect.result);
    if (verifyResult._tag === "Failure") {
      const error = verifyResult.failure;
      if (error instanceof Error && error.message.startsWith("configured upstream resolved to ")) {
        return yield* Effect.fail(error);
      }
      const cleanupError = yield* cleanupFailedUpstreamSetup(
        runner,
        repoPath,
        branchRemoteKey,
        branchMergeKey,
        createdTrackingRef,
      );
      return yield* Effect.fail(
        gitOperationError(
          `Failed verifying upstream tracking for task worktree branch ${targetBranch}: ${String(error)}${cleanupError}`,
          "git.verify-upstream-tracking",
          error,
        ),
      );
    }
    return { createdTrackingRef };
  });
export const removeWorktree = (
  runner: GitCommandRunner,
  repoPath: string,
  worktreePath: string,
  force: boolean,
) =>
  Effect.gen(function* () {
    const targetWorktreePath = yield* requireNonEmptyEffect(worktreePath, "worktree path");
    const args = ["worktree", "remove"];
    if (force) {
      args.push("--force");
    }
    args.push("--end-of-options", targetWorktreePath);
    yield* runGit(runner, repoPath, args);
  });
export const deleteLocalBranch = (
  runner: GitCommandRunner,
  repoPath: string,
  branch: string,
  force: boolean,
  onDeleting?: (branch: { name: string; oid: string }) => void,
) =>
  Effect.gen(function* () {
    const targetBranch = yield* requireNonEmptyEffect(branch, "branch");
    if (onDeleting) {
      if (
        (yield* listWorktrees(runner, repoPath)).some(
          (worktree) => worktree.branch === targetBranch,
        )
      )
        return yield* gitValidationError(
          `Cannot delete branch ${targetBranch} while a worktree uses it. Stop its sessions and remove that worktree before completing the task.`,
          "sourceBranch",
        );
      const oid = (yield* runGit(runner, repoPath, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `refs/heads/${targetBranch}`,
      ])).trim();
      if (!force) {
        if (!(yield* isAncestor(runner, repoPath, oid, "HEAD")))
          return yield* gitValidationError(
            `Branch ${targetBranch} is not fully merged. Inspect its latest changes before completing the task.`,
            "sourceBranch",
          );
      }
      onDeleting({ name: targetBranch, oid });
      // Compare and delete the captured tip. Keep its tracking settings for recovery.
      yield* runGit(runner, repoPath, ["update-ref", "-d", `refs/heads/${targetBranch}`, oid]);
      return;
    }
    yield* runGit(runner, repoPath, [
      "branch",
      force ? "-D" : "-d",
      "--end-of-options",
      targetBranch,
    ]);
  });

/** Restore only the deleted branch, without overwriting a concurrent ref change. */
export const restoreDeletedBranch = (
  runner: GitCommandRunner,
  repoPath: string,
  branch: { name: string; oid: string },
) =>
  Effect.gen(function* () {
    const name = yield* requireNonEmptyEffect(branch.name, "branch");
    const oid = yield* requireNonEmptyEffect(branch.oid, "revision");
    const ref = `refs/heads/${name}`;
    if (yield* referenceExists(runner, repoPath, ref)) {
      const current = (yield* runGit(runner, repoPath, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        ref,
      ])).trim();
      if (current === oid) return;
      return yield* gitValidationError(
        `The source branch ${name} changed during cleanup. Restore its recorded revision ${oid} before completing the task.`,
        "sourceBranch",
      );
    }
    yield* runGit(runner, repoPath, ["update-ref", ref, oid, ""]);
  });
