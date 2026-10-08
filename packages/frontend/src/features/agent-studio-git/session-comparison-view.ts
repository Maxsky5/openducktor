import type { GitCurrentBranch } from "@openducktor/contracts";
import {
  canonicalTargetBranch,
  targetBranchFromSelection,
  UPSTREAM_TARGET_BRANCH,
} from "@/lib/target-branch";
import type { DiffDataState } from "./contracts";
import type { useSessionComparison } from "./use-session-comparison";

/** Comparison failures do not remove HEAD status, file browsing, or reset snapshots. */
export function buildComparisonView<T extends DiffDataState>(
  data: T,
  comparison: ReturnType<typeof useSessionComparison>,
  label: string,
  branch: GitCurrentBranch | null,
) {
  const target = data.scopeStatesByScope.target;
  let targetLabel = label;
  if (comparison.target?.branch === UPSTREAM_TARGET_BRANCH) {
    targetLabel = "Upstream";
    if (comparison.resolvedTarget) {
      targetLabel = canonicalTargetBranch(targetBranchFromSelection(comparison.resolvedTarget));
    }
  }
  const comparisonPending =
    !target.error &&
    (comparison.isPending ||
      (!!comparison.resolvedTarget &&
        (!data.loadedScopesByScope.target || !data.loadedScopesByScope.uncommitted)));
  const unavailableReason =
    comparison.unavailableReason ??
    target.error ??
    (comparison.resolvedTarget &&
    (!data.loadedScopesByScope.target || !data.loadedScopesByScope.uncommitted)
      ? `Loading comparison ${targetLabel}...`
      : null);
  const reference = unavailableReason ? null : comparison.resolvedTarget;
  const uncommitted = data.scopeStatesByScope.uncommitted;
  const diffScope = reference ? data.diffScope : "uncommitted";
  const active = diffScope === "target" ? target : uncommitted;
  return {
    ...data,
    ...active,
    branch: branch?.name ?? null,
    branchKnown: branch !== null,
    diffScope,
    targetBranch: targetLabel,
    comparisonUnavailableReason: unavailableReason,
    comparisonPending,
    commitsAheadBehind: reference ? target.commitsAheadBehind : null,
    hashVersion: uncommitted.hashVersion,
    statusHash: uncommitted.statusHash,
    diffHash: uncommitted.diffHash,
    scopeStatesByScope: {
      uncommitted,
      target: reference
        ? target
        : { ...target, fileDiffs: [], commitsAheadBehind: null, error: unavailableReason },
    },
    setDiffScope: (scope: "target" | "uncommitted") => {
      if (scope !== "target" || reference) data.setDiffScope(scope);
    },
    comparisonReference: reference,
  };
}
