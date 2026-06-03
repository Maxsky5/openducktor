import type { GitFetchRemoteResult, GitPushBranchResult } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { GitPushBranchOptions } from "../../ports/git-port";
import {
  combineOptionalOutput,
  combineOutput,
  type GitCommandRunner,
  requireNonEmptyEffect,
  runGit,
  runGitAllowFailure,
} from "./git-command-runner";
import { getCurrentBranchUnchecked, parseRemoteNames } from "./git-status";
import {
  normalizeMergeRef,
  resolveFallbackRemoteRefForBranch,
  resolveUpstreamRef,
  resolveUpstreamTargetConfigForBranch,
  upstreamTargetBranch,
} from "./git-upstream";

const gitOperationError = (message: string, operation: string): HostOperationError =>
  new HostOperationError({ message, operation });
const gitValidationError = (message: string, field: string): HostValidationError =>
  new HostValidationError({ message, field });
type GitRemoteSyncError = HostOperationError | HostValidationError;
const remoteNameFromTrackingRef = (targetRef: string): string | undefined => {
  const remainder = targetRef.startsWith("refs/remotes/")
    ? targetRef.slice("refs/remotes/".length)
    : undefined;
  const slash = remainder?.indexOf("/") ?? -1;
  return remainder && slash >= 0 ? remainder.slice(0, slash) : undefined;
};
const isNonFastForwardPushRejection = (output: string): boolean =>
  output
    .split(/\r?\n/)
    .some((line) => line.includes("[rejected]") && line.includes("non-fast-forward")) ||
  (output.includes("rejected") && output.includes("non-fast-forward"));
const resolvePushTrackingSyncRefs = (
  runner: GitCommandRunner,
  workingDirectory: string,
  remote: string,
  branch: string,
): Effect.Effect<
  | {
      localBranchRef: string;
      upstreamRef: string;
    }
  | undefined,
  GitRemoteSyncError
> =>
  Effect.gen(function* () {
    if (remote === ".") {
      return undefined;
    }
    let localBranchRef: string | undefined;
    if (branch === "HEAD") {
      const currentBranch = yield* getCurrentBranchUnchecked(runner, workingDirectory);
      if (!currentBranch.name) {
        return undefined;
      }
      localBranchRef = normalizeMergeRef(currentBranch.name);
    } else if (branch.includes(":")) {
      return undefined;
    } else if (branch.startsWith("refs/heads/")) {
      localBranchRef = branch;
    } else if (branch.startsWith("refs/")) {
      return undefined;
    } else {
      localBranchRef = normalizeMergeRef(branch);
    }
    return {
      localBranchRef,
      upstreamRef: resolveUpstreamRef(remote, localBranchRef),
    };
  });
const syncPushedRemoteTrackingRef = (
  runner: GitCommandRunner,
  workingDirectory: string,
  remote: string,
  branch: string,
) =>
  Effect.gen(function* () {
    const refs = yield* resolvePushTrackingSyncRefs(runner, workingDirectory, remote, branch);
    if (!refs) {
      return;
    }
    const localBranchOid = (yield* runGit(runner, workingDirectory, [
      "rev-parse",
      refs.localBranchRef,
    ])).trim();
    if (!localBranchOid) {
      return yield* Effect.fail(
        gitValidationError(
          `git rev-parse returned an empty revision for ${refs.localBranchRef}`,
          "revision",
        ),
      );
    }
    yield* runGit(runner, workingDirectory, ["update-ref", refs.upstreamRef, localBranchOid]);
  });
const listRemoteNames = (runner: GitCommandRunner, workingDirectory: string) =>
  Effect.gen(function* () {
    const result = yield* runGitAllowFailure(runner, workingDirectory, ["remote"]);
    if (!result.ok) {
      return yield* Effect.fail(
        gitOperationError(
          `Failed to list git remotes: ${combineOutput(result.stdout, result.stderr)}`,
          "git.remote",
        ),
      );
    }
    return new Set(parseRemoteNames(result.stdout));
  });
const pushUniqueRemote = (remotes: string[], seen: Set<string>, remote: string): void => {
  if (!seen.has(remote)) {
    seen.add(remote);
    remotes.push(remote);
  }
};
const pushFallbackRemoteForBranch = (
  runner: GitCommandRunner,
  workingDirectory: string,
  branchName: string,
  remotes: string[],
  seen: Set<string>,
) =>
  Effect.gen(function* () {
    const fallbackRemoteRef = yield* resolveFallbackRemoteRefForBranch(
      runner,
      workingDirectory,
      branchName,
    );
    if (!fallbackRemoteRef) {
      return false;
    }
    const remote = remoteNameFromTrackingRef(fallbackRemoteRef);
    if (!remote) {
      return false;
    }
    pushUniqueRemote(remotes, seen, remote);
    return true;
  });
const resolveCurrentBranchFetchRemote = (
  runner: GitCommandRunner,
  workingDirectory: string,
  currentBranchName: string | undefined,
  availableRemotes: Set<string>,
  remotes: string[],
  seen: Set<string>,
) =>
  Effect.gen(function* () {
    const upstreamTarget = yield* resolveUpstreamTargetConfigForBranch(
      runner,
      workingDirectory,
      currentBranchName,
    );
    if (upstreamTarget) {
      if (upstreamTarget.remote !== ".") {
        if (!availableRemotes.has(upstreamTarget.remote)) {
          return yield* Effect.fail(
            gitValidationError(
              `Cannot refresh changes because the current branch upstream uses unknown remote \`${upstreamTarget.remote}\``,
              "remote",
            ),
          );
        }
        pushUniqueRemote(remotes, seen, upstreamTarget.remote);
        return true;
      }
      return currentBranchName
        ? yield* pushFallbackRemoteForBranch(
            runner,
            workingDirectory,
            currentBranchName,
            remotes,
            seen,
          )
        : false;
    }
    return currentBranchName
      ? yield* pushFallbackRemoteForBranch(
          runner,
          workingDirectory,
          currentBranchName,
          remotes,
          seen,
        )
      : false;
  });
const resolveTargetRemoteName = (
  targetBranch: string,
  availableRemotes: Set<string>,
): string | undefined => {
  if (targetBranch === upstreamTargetBranch) {
    return undefined;
  }
  if (targetBranch.startsWith("refs/remotes/")) {
    const remainder = targetBranch.slice("refs/remotes/".length);
    const slash = remainder.indexOf("/");
    if (slash < 0) {
      return undefined;
    }
    const remote = remainder.slice(0, slash);
    if (availableRemotes.has(remote)) {
      return remote;
    }
    throw gitValidationError(
      `Cannot refresh changes because compare target \`${targetBranch}\` uses unknown remote \`${remote}\``,
      "targetBranch",
    );
  }
  const slash = targetBranch.indexOf("/");
  if (slash < 0) {
    return undefined;
  }
  const remote = targetBranch.slice(0, slash);
  return availableRemotes.has(remote) ? remote : undefined;
};
const resolveRefreshFetchRemotes = (
  runner: GitCommandRunner,
  workingDirectory: string,
  targetBranch: string,
) =>
  Effect.gen(function* () {
    const target = yield* requireNonEmptyEffect(targetBranch, "target branch");
    const currentBranch = yield* getCurrentBranchUnchecked(runner, workingDirectory);
    const availableRemotes = yield* listRemoteNames(runner, workingDirectory);
    const remotes: string[] = [];
    const seen = new Set<string>();
    const hasCurrentBranchRemote = yield* resolveCurrentBranchFetchRemote(
      runner,
      workingDirectory,
      currentBranch.name,
      availableRemotes,
      remotes,
      seen,
    );
    if (target === upstreamTargetBranch && !hasCurrentBranchRemote && availableRemotes.size > 0) {
      return yield* Effect.fail(
        gitValidationError(
          "Cannot refresh changes because compare target `@{upstream}` requires an upstream remote for the current branch",
          "targetBranch",
        ),
      );
    }
    const targetRemote = yield* Effect.try({
      try: () => resolveTargetRemoteName(target, availableRemotes),
      catch: (cause) =>
        cause instanceof HostValidationError
          ? cause
          : gitOperationError(String(cause), "git.resolve-target-remote"),
    });
    if (targetRemote) {
      pushUniqueRemote(remotes, seen, targetRemote);
    }
    return remotes;
  });
export const fetchRemote = (
  runner: GitCommandRunner,
  workingDirectory: string,
  targetBranch: string,
): Effect.Effect<GitFetchRemoteResult, GitRemoteSyncError> =>
  Effect.gen(function* () {
    const remotes = yield* resolveRefreshFetchRemotes(runner, workingDirectory, targetBranch);
    if (remotes.length === 0) {
      return {
        outcome: "skipped_no_remote",
        output:
          "Skipped git fetch because no applicable remote is configured for this repo or branch.",
      };
    }
    const outputs: string[] = [];
    for (const remote of remotes) {
      const result = yield* runGitAllowFailure(runner, workingDirectory, [
        "fetch",
        "--prune",
        "--",
        remote,
      ]);
      const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
      if (!result.ok) {
        return yield* Effect.fail(
          gitOperationError(`git fetch --prune ${remote} failed: ${output}`, "git.fetch"),
        );
      }
      outputs.push(output.length === 0 ? `Fetched ${remote}` : output);
    }
    return {
      outcome: "fetched",
      output: outputs.join("\n"),
    };
  });
export const pushBranch = (
  runner: GitCommandRunner,
  workingDirectory: string,
  branch: string,
  options: GitPushBranchOptions = {},
): Effect.Effect<GitPushBranchResult, GitRemoteSyncError> =>
  Effect.gen(function* () {
    const remote = yield* requireNonEmptyEffect(options.remote ?? "origin", "remote");
    const targetBranch = yield* requireNonEmptyEffect(branch, "branch");
    const args = ["push", "--porcelain"];
    if (options.setUpstream) {
      args.push("-u");
    }
    if (options.forceWithLease) {
      args.push("--force-with-lease");
    }
    args.push("--", remote, targetBranch);
    const pushResult = yield* runGitAllowFailure(runner, workingDirectory, args);
    const output = combineOptionalOutput(pushResult.stdout, pushResult.stderr);
    if (!pushResult.ok) {
      const detail = output.length > 0 ? output : "No output from git push";
      if (isNonFastForwardPushRejection(detail)) {
        return {
          outcome: "rejected_non_fast_forward",
          remote,
          branch: targetBranch,
          output: detail,
        };
      }
      return yield* Effect.fail(
        gitOperationError(`git push failed for ${remote}/${targetBranch}: ${detail}`, "git.push"),
      );
    }
    let pushedOutput = output;
    const syncResult = yield* syncPushedRemoteTrackingRef(
      runner,
      workingDirectory,
      remote,
      targetBranch,
    ).pipe(Effect.either);
    if (syncResult._tag === "Left") {
      const error = syncResult.left;
      const warning = `Push succeeded, but local upstream tracking status may remain stale until the next fetch: ${error instanceof Error ? error.message : String(error)}`;
      pushedOutput = pushedOutput.trim().length > 0 ? `${pushedOutput}\n${warning}` : warning;
    }
    return {
      outcome: "pushed",
      remote,
      branch: targetBranch,
      output: pushedOutput,
    };
  });
