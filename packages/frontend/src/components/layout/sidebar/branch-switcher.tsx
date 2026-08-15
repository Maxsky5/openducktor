import { memo, type ReactElement, useMemo, useRef, useState } from "react";
import { BranchSelector } from "@/components/features/repository/branch-selector";
import { toBranchSelectorOptions } from "@/components/features/repository/branch-selector-model";
import { useWorkspaceBranchState } from "@/state/app-state-provider";

type PendingBranchSelection = {
  repoPath: string;
  requestId: number;
  value: string;
};

export const BranchSwitcher = memo(function BranchSwitcher(): ReactElement | null {
  const {
    activeWorkspace,
    branches,
    activeBranch,
    isLoadingBranches,
    isSwitchingBranch,
    branchSyncDegraded,
    switchBranch,
  } = useWorkspaceBranchState();
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const [pendingBranchSelection, setPendingBranchSelection] =
    useState<PendingBranchSelection | null>(null);
  const pendingBranchRequestIdRef = useRef(0);
  const activeBranchValue = activeBranch?.name ?? "";

  const branchOptions = useMemo(() => toBranchSelectorOptions(branches), [branches]);
  const activePendingBranchValue =
    pendingBranchSelection?.repoPath === workspaceRepoPath ? pendingBranchSelection.value : null;
  const selectedBranchValue = isSwitchingBranch
    ? (activePendingBranchValue ?? activeBranchValue)
    : activeBranchValue;

  if (!workspaceRepoPath) {
    return null;
  }

  const isBranchPickerDisabled =
    isLoadingBranches || isSwitchingBranch || branchOptions.length === 0;
  const defaultBranchPlaceholder = isLoadingBranches ? "Loading branches..." : "Select branch...";
  const branchPlaceholder = activeBranch?.detached ? "Detached HEAD" : defaultBranchPlaceholder;

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

          const requestId = ++pendingBranchRequestIdRef.current;
          setPendingBranchSelection({
            repoPath: workspaceRepoPath,
            requestId,
            value: nextBranch,
          });
          void switchBranch(nextBranch)
            .catch(() => undefined)
            .finally(() => {
              setPendingBranchSelection((currentSelection) =>
                currentSelection?.repoPath === workspaceRepoPath &&
                currentSelection.requestId === requestId
                  ? null
                  : currentSelection,
              );
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
});
