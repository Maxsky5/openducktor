import { Effect } from "effect";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import {
  combineOutput,
  type GitCommandRunner,
  referenceExists,
  requireNonEmptyEffect,
  runGit,
  runGitAllowFailure,
} from "./git-command-runner";

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
    ]).pipe(Effect.either);
    if (mergeConfigResult._tag === "Left") {
      const error = mergeConfigResult.left;
      const cleanupError = yield* cleanupFailedUpstreamSetup(
        runner,
        repoPath,
        branchRemoteKey,
        null,
        null,
      );
      return yield* Effect.fail(
        gitOperationError(
          `Failed configuring upstream merge for build worktree branch ${targetBranch}: ${String(error)}${cleanupError}`,
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
      }).pipe(Effect.either);
      if (trackingResult._tag === "Left") {
        const error = trackingResult.left;
        const cleanupError = yield* cleanupFailedUpstreamSetup(
          runner,
          repoPath,
          branchRemoteKey,
          branchMergeKey,
          null,
        );
        return yield* Effect.fail(
          gitOperationError(
            `Failed creating upstream tracking ref ${trackingRef} for build worktree branch ${targetBranch}: ${String(error)}${cleanupError}`,
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
    }).pipe(Effect.either);
    if (verifyResult._tag === "Left") {
      const error = verifyResult.left;
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
          `Failed verifying upstream tracking for build worktree branch ${targetBranch}: ${String(error)}${cleanupError}`,
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
) =>
  Effect.gen(function* () {
    const targetBranch = yield* requireNonEmptyEffect(branch, "branch");
    yield* runGit(runner, repoPath, [
      "branch",
      force ? "-D" : "-d",
      "--end-of-options",
      targetBranch,
    ]);
  });
