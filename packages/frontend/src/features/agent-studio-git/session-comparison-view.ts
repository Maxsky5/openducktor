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
) {
  const target = data.scopeStatesByScope.target;
  const targetLabel =
    comparison.target?.branch === UPSTREAM_TARGET_BRANCH
      ? comparison.resolvedTarget
        ? canonicalTargetBranch(targetBranchFromSelection(comparison.resolvedTarget))
        : "Upstream"
      : label;
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
    diffScope,
    targetBranch: targetLabel,
    comparisonUnavailableReason: unavailableReason,
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
