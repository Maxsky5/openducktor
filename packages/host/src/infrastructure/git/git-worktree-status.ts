import type { GitDiffScope } from "@openducktor/contracts";
import type { GitWorktreeStatusData, GitWorktreeStatusSummaryData } from "../../ports/git-port";
import { type GitCommandRunner, requireNonEmpty } from "./git-command-runner";
import { buildFileDiffs, loadBranchChangesDiffPayload, loadDiffPayload } from "./git-diff";
import { fileStatusCounts, getCurrentBranchUnchecked, getStatusUnchecked } from "./git-status";
import {
  commitsAgainstTargetOrDefault,
  loadRebaseConflictContext,
  resolveEffectiveTargetBranch,
  resolveUpstreamAheadBehind,
  resolveUpstreamTargetForBranch,
} from "./git-upstream";

export const buildWorktreeStatusData = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  targetBranch: string,
  diffScope: GitDiffScope,
): Promise<GitWorktreeStatusData> => {
  const target = requireNonEmpty(targetBranch, "target branch");
  const currentBranch = await getCurrentBranchUnchecked(runner, workingDirectory);
  const upstreamTarget = await resolveUpstreamTargetForBranch(
    runner,
    workingDirectory,
    currentBranch.name,
  );
  const effectiveTargetBranch = resolveEffectiveTargetBranch(target, upstreamTarget);
  const fileStatuses = await getStatusUnchecked(runner, workingDirectory);
  const rawDiffPayload =
    diffScope === "target"
      ? effectiveTargetBranch
        ? await loadBranchChangesDiffPayload(runner, workingDirectory, effectiveTargetBranch)
        : undefined
      : await loadDiffPayload(runner, workingDirectory);
  const fileDiffs = rawDiffPayload
    ? await buildFileDiffs(
        runner,
        workingDirectory,
        fileStatuses,
        rawDiffPayload.numstat,
        rawDiffPayload.diff,
      )
    : [];
  const targetAheadBehind = await commitsAgainstTargetOrDefault(
    runner,
    workingDirectory,
    effectiveTargetBranch,
  );
  const upstreamAheadBehind = await resolveUpstreamAheadBehind(
    runner,
    workingDirectory,
    upstreamTarget,
    targetAheadBehind,
  );
  const gitConflict = await loadRebaseConflictContext(
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
};

export const buildWorktreeStatusSummaryData = async (
  runner: GitCommandRunner,
  workingDirectory: string,
  targetBranch: string,
  _diffScope: GitDiffScope,
): Promise<GitWorktreeStatusSummaryData> => {
  const target = requireNonEmpty(targetBranch, "target branch");
  const currentBranch = await getCurrentBranchUnchecked(runner, workingDirectory);
  const upstreamTarget = await resolveUpstreamTargetForBranch(
    runner,
    workingDirectory,
    currentBranch.name,
  );
  const effectiveTargetBranch = resolveEffectiveTargetBranch(target, upstreamTarget);
  const fileStatuses = await getStatusUnchecked(runner, workingDirectory);
  const targetAheadBehind = await commitsAgainstTargetOrDefault(
    runner,
    workingDirectory,
    effectiveTargetBranch,
  );
  const upstreamAheadBehind = await resolveUpstreamAheadBehind(
    runner,
    workingDirectory,
    upstreamTarget,
    targetAheadBehind,
  );
  const gitConflict = await loadRebaseConflictContext(
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
};
