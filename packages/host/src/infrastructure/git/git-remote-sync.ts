import type { GitFetchRemoteResult, GitPushBranchResult } from "@openducktor/contracts";
import type { GitPushBranchOptions } from "../../ports/git-port";
import {
  combineOptionalOutput,
  combineOutput,
  type GitCommandRunner,
  requireNonEmpty,
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

export const remoteNameFromTrackingRef = (targetRef: string): string | undefined => {
  const remainder = targetRef.startsWith("refs/remotes/")
    ? targetRef.slice("refs/remotes/".length)
    : undefined;
  const slash = remainder?.indexOf("/") ?? -1;
  return remainder && slash >= 0 ? remainder.slice(0, slash) : undefined;
};

export const isNonFastForwardPushRejection = (output: string): boolean =>
  output
    .split(/\r?\n/)
    .some((line) => line.includes("[rejected]") && line.includes("non-fast-forward")) ||
  (output.includes("rejected") && output.includes("non-fast-forward"));

export const resolvePushTrackingSyncRefs = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  remote: string,
  branch: string,
): Promise<{ localBranchRef: string; upstreamRef: string } | undefined> => {
  if (remote === ".") {
    return undefined;
  }

  let localBranchRef: string | undefined;
  if (branch === "HEAD") {
    const currentBranch = await getCurrentBranchUnchecked(runner, workingDirectory);
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
};

export const syncPushedRemoteTrackingRef = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  remote: string,
  branch: string,
): Promise<void> => {
  const refs = await resolvePushTrackingSyncRefs(runner, workingDirectory, remote, branch);
  if (!refs) {
    return;
  }

  const localBranchOid = (
    await runGit(runner, workingDirectory, ["rev-parse", refs.localBranchRef])
  ).trim();
  if (!localBranchOid) {
    throw new Error(`git rev-parse returned an empty revision for ${refs.localBranchRef}`);
  }

  await runGit(runner, workingDirectory, ["update-ref", refs.upstreamRef, localBranchOid]);
};

export const listRemoteNames = async (
  runner: GitCommandRunner,
  workingDirectory: string,
): Promise<Set<string>> => {
  const result = await runGitAllowFailure(runner, workingDirectory, ["remote"]);
  if (!result.ok) {
    throw new Error(`Failed to list git remotes: ${combineOutput(result.stdout, result.stderr)}`);
  }

  return new Set(parseRemoteNames(result.stdout));
};

export const pushUniqueRemote = (remotes: string[], seen: Set<string>, remote: string): void => {
  if (!seen.has(remote)) {
    seen.add(remote);
    remotes.push(remote);
  }
};

export const pushFallbackRemoteForBranch = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  branchName: string,
  remotes: string[],
  seen: Set<string>,
): Promise<boolean> => {
  const fallbackRemoteRef = await resolveFallbackRemoteRefForBranch(
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
};

export const resolveCurrentBranchFetchRemote = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  currentBranchName: string | undefined,
  availableRemotes: Set<string>,
  remotes: string[],
  seen: Set<string>,
): Promise<boolean> => {
  const upstreamTarget = await resolveUpstreamTargetConfigForBranch(
    runner,
    workingDirectory,
    currentBranchName,
  );

  if (upstreamTarget) {
    if (upstreamTarget.remote !== ".") {
      if (!availableRemotes.has(upstreamTarget.remote)) {
        throw new Error(
          `Cannot refresh changes because the current branch upstream uses unknown remote \`${upstreamTarget.remote}\``,
        );
      }

      pushUniqueRemote(remotes, seen, upstreamTarget.remote);
      return true;
    }

    return currentBranchName
      ? pushFallbackRemoteForBranch(runner, workingDirectory, currentBranchName, remotes, seen)
      : false;
  }

  return currentBranchName
    ? pushFallbackRemoteForBranch(runner, workingDirectory, currentBranchName, remotes, seen)
    : false;
};

export const resolveTargetRemoteName = (
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
    throw new Error(
      `Cannot refresh changes because compare target \`${targetBranch}\` uses unknown remote \`${remote}\``,
    );
  }

  const slash = targetBranch.indexOf("/");
  if (slash < 0) {
    return undefined;
  }

  const remote = targetBranch.slice(0, slash);
  return availableRemotes.has(remote) ? remote : undefined;
};

export const resolveRefreshFetchRemotes = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  targetBranch: string,
): Promise<string[]> => {
  const target = requireNonEmpty(targetBranch, "target branch");
  const currentBranch = await getCurrentBranchUnchecked(runner, workingDirectory);
  const availableRemotes = await listRemoteNames(runner, workingDirectory);
  const remotes: string[] = [];
  const seen = new Set<string>();
  const hasCurrentBranchRemote = await resolveCurrentBranchFetchRemote(
    runner,
    workingDirectory,
    currentBranch.name,
    availableRemotes,
    remotes,
    seen,
  );

  if (target === upstreamTargetBranch && !hasCurrentBranchRemote && availableRemotes.size > 0) {
    throw new Error(
      "Cannot refresh changes because compare target `@{upstream}` requires an upstream remote for the current branch",
    );
  }

  const targetRemote = resolveTargetRemoteName(target, availableRemotes);
  if (targetRemote) {
    pushUniqueRemote(remotes, seen, targetRemote);
  }

  return remotes;
};

export const fetchRemote = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  targetBranch: string,
): Promise<GitFetchRemoteResult> => {
  const remotes = await resolveRefreshFetchRemotes(runner, workingDirectory, targetBranch);
  if (remotes.length === 0) {
    return {
      outcome: "skipped_no_remote",
      output:
        "Skipped git fetch because no applicable remote is configured for this repo or branch.",
    };
  }

  const outputs: string[] = [];
  for (const remote of remotes) {
    const result = await runGitAllowFailure(runner, workingDirectory, [
      "fetch",
      "--prune",
      "--",
      remote,
    ]);
    const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
    if (!result.ok) {
      throw new Error(`git fetch --prune ${remote} failed: ${output}`);
    }
    outputs.push(output.length === 0 ? `Fetched ${remote}` : output);
  }

  return {
    outcome: "fetched",
    output: outputs.join("\n"),
  };
};

export const pushBranch = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  branch: string,
  options: GitPushBranchOptions = {},
): Promise<GitPushBranchResult> => {
  const remote = requireNonEmpty(options.remote ?? "origin", "remote");
  const targetBranch = requireNonEmpty(branch, "branch");
  const args = ["push", "--porcelain"];
  if (options.setUpstream) {
    args.push("-u");
  }
  if (options.forceWithLease) {
    args.push("--force-with-lease");
  }
  args.push("--", remote, targetBranch);

  const pushResult = await runGitAllowFailure(runner, workingDirectory, args);
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

    throw new Error(`git push failed for ${remote}/${targetBranch}: ${detail}`);
  }

  let pushedOutput = output;
  try {
    await syncPushedRemoteTrackingRef(runner, workingDirectory, remote, targetBranch);
  } catch (error) {
    const warning = `Push succeeded, but local upstream tracking status may remain stale until the next fetch: ${
      error instanceof Error ? error.message : String(error)
    }`;
    pushedOutput = pushedOutput.trim().length > 0 ? `${pushedOutput}\n${warning}` : warning;
  }

  return {
    outcome: "pushed",
    remote,
    branch: targetBranch,
    output: pushedOutput,
  };
};
