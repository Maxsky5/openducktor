import { type ReactElement, useMemo, useState } from "react";
import { BranchSelector } from "@/components/features/repository/branch-selector";
import { toBranchSelectorOptions } from "@/components/features/repository/branch-selector-model";
import { useWorkspaceState } from "@/state/app-state-provider";

export function BranchSwitcher(): ReactElement | null {
  const {
    activeWorkspace,
    branches,
    activeBranch,
    isSwitchingWorkspace,
    isLoadingBranches,
    isSwitchingBranch,
    branchSyncDegraded,
    switchBranch,
  } = useWorkspaceState();
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const [pendingBranchValue, setPendingBranchValue] = useState<string | null>(null);
  const activeBranchValue = activeBranch?.name ?? "";

  const branchOptions = useMemo(() => toBranchSelectorOptions(branches), [branches]);
  const selectedBranchValue = isSwitchingBranch
    ? (pendingBranchValue ?? activeBranchValue)
    : activeBranchValue;

  if (!workspaceRepoPath) {
    return null;
  }

  const isBranchPickerDisabled =
    isSwitchingWorkspace || isLoadingBranches || isSwitchingBranch || branchOptions.length === 0;
  const branchPlaceholder = activeBranch?.detached
    ? "Detached HEAD"
    : isLoadingBranches
      ? "Loading branches..."
      : "Select branch...";

  return (
    <div className="space-y-2">
      <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-sidebar-muted-foreground">
        Branch
      </p>
      <BranchSelector
        value={selectedBranchValue}
        options={branchOptions}
        disabled={isBranchPickerDisabled}
        placeholder={branchPlaceholder}
        popoverClassName="w-[min(28rem,calc(100vw-2rem))] p-0"
        onValueChange={(nextBranch) => {
          const previousBranch = activeBranchValue;

          if (!nextBranch || nextBranch === previousBranch) {
            return;
          }

          setPendingBranchValue(nextBranch);
          void switchBranch(nextBranch)
            .catch(() => undefined)
            .finally(() => {
              setPendingBranchValue(null);
            });
        }}
      />
      {branchSyncDegraded ? (
        <p className="px-1 text-[11px] text-amber-700 dark:text-amber-400">
          Branch sync degraded. Auto-refresh may be stale.
        </p>
      ) : null}
      {activeBranch?.detached ? (
        <p className="px-1 text-[11px] text-muted-foreground">Detached HEAD</p>
      ) : null}
    </div>
  );
}
