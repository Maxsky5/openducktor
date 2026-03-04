import { type ReactElement, useEffect, useMemo, useState } from "react";
import { BranchSelector } from "@/components/features/repository/branch-selector";
import { toBranchSelectorOptions } from "@/components/features/repository/branch-selector-model";
import { useWorkspaceState } from "@/state";

export function BranchSwitcher(): ReactElement | null {
  const {
    activeRepo,
    branches,
    activeBranch,
    isLoadingBranches,
    isSwitchingBranch,
    branchSyncDegraded,
    switchBranch,
  } = useWorkspaceState();
  const [selectedBranchValue, setSelectedBranchValue] = useState("");

  const branchOptions = useMemo(() => toBranchSelectorOptions(branches), [branches]);

  useEffect(() => {
    setSelectedBranchValue(activeBranch?.name ?? "");
  }, [activeBranch?.name]);

  if (!activeRepo) {
    return null;
  }

  const isBranchPickerDisabled =
    isLoadingBranches || isSwitchingBranch || branchOptions.length === 0;
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
          const previousBranch = activeBranch?.name ?? "";

          if (!nextBranch || nextBranch === previousBranch) {
            return;
          }

          setSelectedBranchValue(nextBranch);
          void switchBranch(nextBranch).catch(() => {
            setSelectedBranchValue(previousBranch);
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
