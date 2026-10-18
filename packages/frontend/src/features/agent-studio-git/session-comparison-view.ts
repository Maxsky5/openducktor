import type { GitCurrentBranch } from "@openducktor/contracts";
import { useMemo } from "react";
import {
  canonicalTargetBranch,
  targetBranchFromSelection,
  UPSTREAM_TARGET_BRANCH,
} from "@openducktor/frontend-core/lib/target-branch";
import type { DiffDataState } from "./contracts";
import { toStatusSnapshotKey } from "./model/scope-state";
import type { GitPanelReads } from "./reads/use-git-panel-reads";
import type { useSessionComparison } from "./use-session-comparison";

type ComparisonViewInput = {
  /** The repository that the reads use, or null while reads are blocked. */
  repoPath: string | null;
  worktreePath: string | null;
  label: string;
  checkout: GitCurrentBranch | null;
};

/**
 * Builds the panel data of one comparison. Branch changes and History show only after the checked
 * comparison and both scopes load. A comparison failure keeps local changes and their snapshots.
 */
export function useComparisonView(
  reads: GitPanelReads,
  comparison: ReturnType<typeof useSessionComparison>,
  input: ComparisonViewInput,
): DiffDataState {
  const { scopeStatesByScope, loadedScopesByScope, isLoading } = reads;
  const { target, resolvedTarget, isPending, unavailableReason } = comparison;
  const { repoPath, worktreePath, label, checkout } = input;
  // A stable view keeps the memoized Git panel from drawing again for an unrelated render.
  return useMemo(
    () =>
      buildComparisonView(
        { scopeStatesByScope, loadedScopesByScope, isLoading },
        { target, resolvedTarget, isPending, unavailableReason },
        { repoPath, worktreePath, label, checkout },
      ),
    [
      checkout,
      isLoading,
      isPending,
      label,
      loadedScopesByScope,
      repoPath,
      resolvedTarget,
      scopeStatesByScope,
      target,
      unavailableReason,
      worktreePath,
    ],
  );
}

function buildComparisonView(
  reads: Pick<GitPanelReads, "scopeStatesByScope" | "loadedScopesByScope" | "isLoading">,
  comparison: Pick<
    ReturnType<typeof useSessionComparison>,
    "target" | "resolvedTarget" | "isPending" | "unavailableReason"
  >,
  { repoPath, worktreePath, label, checkout }: ComparisonViewInput,
): DiffDataState {
  const { scopeStatesByScope, loadedScopesByScope } = reads;
  const local = scopeStatesByScope.uncommitted;
  const target = scopeStatesByScope.target;
  let targetLabel = label;
  if (comparison.target?.branch === UPSTREAM_TARGET_BRANCH) {
    targetLabel = comparison.resolvedTarget
      ? canonicalTargetBranch(targetBranchFromSelection(comparison.resolvedTarget))
      : "Upstream";
  }
  const scopesLoading =
    !!comparison.resolvedTarget &&
    (!loadedScopesByScope.target || !loadedScopesByScope.uncommitted);
  const comparisonPending = !target.error && (comparison.isPending || scopesLoading);
  const unavailableReason =
    comparison.unavailableReason ??
    target.error ??
    (scopesLoading ? `Loading comparison ${targetLabel}...` : null);
  const reference = unavailableReason ? null : comparison.resolvedTarget;
  return {
    repoPath,
    branch: checkout?.name ?? null,
    branchKnown: checkout !== null,
    checkout,
    worktreePath,
    targetBranch: targetLabel,
    comparisonReference: reference,
    comparisonPending,
    comparisonUnavailableReason: unavailableReason,
    gitConflict: local.gitConflict ?? null,
    scopeStatesByScope: {
      uncommitted: local,
      // A loading comparison is not a failure, so its view shows loading instead of an error.
      target: reference
        ? target
        : {
            ...target,
            fileDiffs: [],
            fileStatuses: [],
            commitsAheadBehind: null,
            error: comparisonPending ? null : unavailableReason,
          },
    },
    loadedScopesByScope,
    commitsAheadBehind: reference ? target.commitsAheadBehind : null,
    upstreamAheadBehind: local.upstreamAheadBehind,
    upstreamStatus: local.upstreamStatus,
    upstreamError: local.upstreamError ?? null,
    fileStatuses: local.fileStatuses,
    statusSnapshotKey: loadedScopesByScope.uncommitted ? toStatusSnapshotKey(local) : null,
    hashVersion: local.hashVersion,
    statusHash: local.statusHash,
    diffHash: local.diffHash,
    uncommittedFileCount: local.uncommittedFileCount,
    isLoading: reads.isLoading,
  };
}
