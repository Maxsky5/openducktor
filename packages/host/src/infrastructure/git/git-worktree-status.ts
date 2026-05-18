import type { GitDiffScope } from "@openducktor/contracts";
import { Effect } from "effect";
import { type GitCommandRunner, requireNonEmptyEffect } from "./git-command-runner";
import { buildFileDiffs, loadBranchChangesDiffPayload, loadDiffPayload } from "./git-diff";
import { fileStatusCounts, getCurrentBranchUnchecked, getStatusUnchecked } from "./git-status";
import {
  commitsAgainstTargetOrDefault,
  loadRebaseConflictContext,
  resolveEffectiveTargetBranch,
  resolveUpstreamAheadBehind,
  resolveUpstreamTargetForBranch,
} from "./git-upstream";
export const buildWorktreeStatusData = (
  runner: GitCommandRunner,
  workingDirectory: string,
  targetBranch: string,
  diffScope: GitDiffScope,
) =>
  Effect.gen(function* () {
    const target = yield* requireNonEmptyEffect(targetBranch, "target branch");
    const currentBranch = yield* getCurrentBranchUnchecked(runner, workingDirectory);
    const upstreamTarget = yield* resolveUpstreamTargetForBranch(
      runner,
      workingDirectory,
      currentBranch.name,
    );
    const effectiveTargetBranch = resolveEffectiveTargetBranch(target, upstreamTarget);
    const fileStatuses = yield* getStatusUnchecked(runner, workingDirectory);
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
      targetAheadBehind,
    );
    const gitConflict = yield* loadRebaseConflictContext(
      runner,
      workingDirectory,
      currentBranch,
      effectiveTargetBranch,
      fileStatuses,
    );
    return {
      currentBranch,
      fileStatuses,
      fileDiffs,
      targetAheadBehind,
      upstreamAheadBehind,
      ...(gitConflict ? { gitConflict } : {}),
    };
  });
export const buildWorktreeStatusSummaryData = (
  runner: GitCommandRunner,
  workingDirectory: string,
  targetBranch: string,
  _diffScope: GitDiffScope,
) =>
  Effect.gen(function* () {
    const target = yield* requireNonEmptyEffect(targetBranch, "target branch");
    const currentBranch = yield* getCurrentBranchUnchecked(runner, workingDirectory);
    const upstreamTarget = yield* resolveUpstreamTargetForBranch(
      runner,
      workingDirectory,
      currentBranch.name,
    );
    const effectiveTargetBranch = resolveEffectiveTargetBranch(target, upstreamTarget);
    const fileStatuses = yield* getStatusUnchecked(runner, workingDirectory);
    const targetAheadBehind = yield* commitsAgainstTargetOrDefault(
      runner,
      workingDirectory,
      effectiveTargetBranch,
    );
    const upstreamAheadBehind = yield* resolveUpstreamAheadBehind(
      runner,
      workingDirectory,
      upstreamTarget,
      targetAheadBehind,
    );
    const gitConflict = yield* loadRebaseConflictContext(
      runner,
      workingDirectory,
      currentBranch,
      effectiveTargetBranch,
      fileStatuses,
    );
    return {
      currentBranch,
      fileStatuses,
      fileStatusCounts: fileStatusCounts(fileStatuses),
      targetAheadBehind,
      upstreamAheadBehind,
      ...(gitConflict ? { gitConflict } : {}),
    };
  });
