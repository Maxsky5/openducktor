import type { GitDiffScope, GitCurrentBranch } from "@openducktor/contracts";
import { Effect } from "effect";
import type { GitFileStatus, GitPortError } from "../../ports/git-port";
import { type GitCommandRunner, requireNonEmptyEffect } from "./git-command-runner";
import { buildFileDiffs, loadBranchChangesDiffPayload, loadDiffPayload } from "./git-diff";
import { fileStatusCounts, getCurrentBranchUnchecked, getStatusUnchecked } from "./git-status";
import {
  commitsAgainstTargetOrDefault,
  loadRebaseConflictContext,
  resolveEffectiveTargetBranch,
  resolveUpstreamAheadBehind,
  resolveTrackedUpstreamReference,
} from "./git-upstream";
type WorktreeReads = {
  branch: () => Effect.Effect<GitCurrentBranch, GitPortError>;
  status: () => Effect.Effect<GitFileStatus[], GitPortError>;
};
export const buildWorktreeStatusData = (
  runner: GitCommandRunner,
  workingDirectory: string,
  targetBranch: string,
  diffScope: GitDiffScope,
  reads: WorktreeReads = {
    branch: () => getCurrentBranchUnchecked(runner, workingDirectory),
    status: () => getStatusUnchecked(runner, workingDirectory),
  },
) =>
  Effect.gen(function* () {
    const target = yield* requireNonEmptyEffect(targetBranch, "target branch");
    const currentBranch = yield* reads.branch();
    const upstreamTarget = yield* resolveTrackedUpstreamReference(
      runner,
      workingDirectory,
      currentBranch.name,
    );
    const effectiveTargetBranch = resolveEffectiveTargetBranch(target, upstreamTarget);
    const fileStatuses = yield* reads.status();
    const rawDiffPayload =
      diffScope === "target"
        ? effectiveTargetBranch
          ? yield* loadBranchChangesDiffPayload(runner, workingDirectory, effectiveTargetBranch)
          : undefined
        : yield* loadDiffPayload(runner, workingDirectory);
    const fileDiffs = rawDiffPayload
      ? yield* buildFileDiffs(
          runner,
          workingDirectory,
          fileStatuses,
          rawDiffPayload.numstat,
          rawDiffPayload.diff,
        )
      : [];
    const targetAheadBehind = yield* commitsAgainstTargetOrDefault(
      runner,
      workingDirectory,
      effectiveTargetBranch,
    );
    const upstreamAheadBehind = yield* resolveUpstreamAheadBehind(
      runner,
      workingDirectory,
      upstreamTarget,
    );
    const gitConflict = yield* loadRebaseConflictContext(
      runner,
      workingDirectory,
      currentBranch,
      effectiveTargetBranch,
      fileStatuses,
    );
    const status = {
      currentBranch,
      fileStatuses,
      fileDiffs,
      targetAheadBehind,
      upstreamAheadBehind,
    };
    return gitConflict ? { ...status, gitConflict } : status;
  });
export const buildWorktreeStatusSummaryData = (
  runner: GitCommandRunner,
  workingDirectory: string,
  targetBranch: string,
  _diffScope: GitDiffScope,
  reads: WorktreeReads = {
    branch: () => getCurrentBranchUnchecked(runner, workingDirectory),
    status: () => getStatusUnchecked(runner, workingDirectory),
  },
) =>
  Effect.gen(function* () {
    const target = yield* requireNonEmptyEffect(targetBranch, "target branch");
    const currentBranch = yield* reads.branch();
    const upstreamTarget = yield* resolveTrackedUpstreamReference(
      runner,
      workingDirectory,
      currentBranch.name,
    );
    const effectiveTargetBranch = resolveEffectiveTargetBranch(target, upstreamTarget);
    const fileStatuses = yield* reads.status();
    const targetAheadBehind = yield* commitsAgainstTargetOrDefault(
      runner,
      workingDirectory,
      effectiveTargetBranch,
    );
    const upstreamAheadBehind = yield* resolveUpstreamAheadBehind(
      runner,
      workingDirectory,
      upstreamTarget,
    );
    const gitConflict = yield* loadRebaseConflictContext(
      runner,
      workingDirectory,
      currentBranch,
      effectiveTargetBranch,
      fileStatuses,
    );
    const status = {
      currentBranch,
      fileStatuses,
      fileStatusCounts: fileStatusCounts(fileStatuses),
      targetAheadBehind,
      upstreamAheadBehind,
    };
    return gitConflict ? { ...status, gitConflict } : status;
  });
