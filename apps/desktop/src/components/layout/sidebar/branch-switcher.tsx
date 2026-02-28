import type { GitBranch } from "@openducktor/contracts";
import { GitBranch as GitBranchIcon } from "lucide-react";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { useWorkspaceState } from "@/state";

function branchSourceLabel(branch: GitBranch): string {
  if (!branch.isRemote) {
    return "local";
  }

  const [remoteName] = branch.name.split("/");
  return remoteName || "remote";
}

export function BranchSwitcher(): ReactElement | null {
  const { activeRepo, branches, activeBranch, isLoadingBranches, isSwitchingBranch, switchBranch } =
    useWorkspaceState();
  const [selectedBranchValue, setSelectedBranchValue] = useState("");

  const branchOptions = useMemo<ComboboxOption[]>(
    () =>
      branches.map((branch) => ({
        value: branch.name,
        label: branch.name,
        secondaryLabel: branchSourceLabel(branch),
        ...(branch.isCurrent ? { description: "current" } : {}),
        searchKeywords: branch.name.split("/").filter(Boolean),
      })),
    [branches],
  );

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
      <div className="relative">
        <GitBranchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Combobox
          value={selectedBranchValue}
          options={branchOptions}
          disabled={isBranchPickerDisabled}
          placeholder={branchPlaceholder}
          searchPlaceholder="Search branch..."
          emptyText="No branch found."
          wrapOptionLabels
          className="w-[min(28rem,calc(100vw-2rem))] p-0"
          triggerClassName="h-9 w-full rounded-md border-input bg-card pl-8 pr-3 text-sm text-foreground"
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
      </div>
      {activeBranch?.detached ? (
        <p className="px-1 text-[11px] text-muted-foreground">Detached HEAD</p>
      ) : null}
    </div>
  );
}
