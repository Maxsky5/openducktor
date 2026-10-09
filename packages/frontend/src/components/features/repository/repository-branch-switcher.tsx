import { GitBranch, Pencil } from "lucide-react";
import { memo, type ReactElement, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { BranchSelector } from "@/components/features/repository/branch-selector";
import { toBranchSelectorOptions } from "@/components/features/repository/branch-selector-model";
import { useWorkspacePreviewTransitionGuard } from "@/components/layout/workspace-preview-transition-guard";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import { useWorkspaceBranchState } from "@/state/app-state-provider";

type RepositoryBranchSwitcherLayout = "stacked" | "inline";

const LAYOUT_CLASSES = {
  stacked: {
    root: "space-y-2",
    row: "space-y-2",
    label: "px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
    selector: "",
    trigger: "",
  },
  inline: {
    root: "space-y-1",
    row: "flex h-7 min-w-0 items-center gap-1.5",
    label: "sr-only",
    selector: "shrink-0",
    trigger: "h-7 text-xs",
  },
} satisfies Record<RepositoryBranchSwitcherLayout, Record<string, string>>;

type PendingBranchSelection = {
  repoPath: string;
  requestId: number;
  value: string;
};

/**
 * Switch the branch of the active workspace's repository root.
 * Worktree branches keep their own operations in the Git panel.
 */
export const RepositoryBranchSwitcher = memo(function RepositoryBranchSwitcher({
  layout = "stacked",
}: {
  /** `inline` fits a one-line branch row, such as the Git panel header. */
  layout?: RepositoryBranchSwitcherLayout;
}): ReactElement | null {
  const { run: guardBranchSwitch } = useWorkspacePreviewTransitionGuard();
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

  const classes = LAYOUT_CLASSES[layout];

  return (
    <div className={classes.root}>
      <RepositoryBranchRow
        layout={layout}
        repoPath={workspaceRepoPath}
        value={selectedBranchValue}
        options={branchOptions}
        disabled={isBranchPickerDisabled}
        placeholder={branchPlaceholder}
        onValueChange={(nextBranch) => {
          const previousBranch = activeBranchValue;

          if (!nextBranch || nextBranch === previousBranch) {
            return;
          }

          guardBranchSwitch(
            () => {
              const requestId = ++pendingBranchRequestIdRef.current;
              setPendingBranchSelection({
                repoPath: workspaceRepoPath,
                requestId,
                value: nextBranch,
              });
              return new Promise<boolean>((resolve) => {
                let switched = false;
                void switchBranch(nextBranch, () => {
                  switched = true;
                  resolve(true);
                })
                  .catch((error) => {
                    if (!switched) {
                      toast.error("Failed to switch branch", {
                        description: errorMessage(error),
                      });
                    }
                  })
                  .finally(() => {
                    resolve(false);
                    setPendingBranchSelection((currentSelection) =>
                      currentSelection?.repoPath === workspaceRepoPath &&
                      currentSelection.requestId === requestId
                        ? null
                        : currentSelection,
                    );
                  });
              });
            },
            undefined,
            { waitForSuccess: true, kind: "root_branch_switch" },
          );
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

function RepositoryBranchRow({
  layout,
  repoPath,
  value,
  options,
  disabled,
  placeholder,
  onValueChange,
}: Pick<Parameters<typeof BranchSelector>[0], "value" | "options" | "onValueChange"> & {
  layout: RepositoryBranchSwitcherLayout;
  repoPath: string;
  disabled: boolean;
  placeholder: string;
}): ReactElement {
  const labelId = `${useId()}-repository-branch`;
  const classes = LAYOUT_CLASSES[layout];
  return (
    <div className={classes.row}>
      <p id={labelId} className={classes.label} title={repoPath}>
        Repository branch
      </p>
      {layout === "inline" ? (
        <>
          <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
          <span
            className="min-w-0 flex-1 truncate font-mono text-xs text-foreground"
            title={`Current branch: ${value || placeholder}`}
          >
            {value || placeholder}
          </span>
        </>
      ) : null}
      <BranchSelector
        value={value}
        options={options}
        disabled={disabled}
        placeholder={placeholder}
        className={classes.selector}
        triggerClassName={classes.trigger}
        triggerAriaLabelledBy={labelId}
        {...(layout === "inline"
          ? {
              trigger: (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  aria-label="Edit repository branch"
                  title="Switch repository branch"
                  disabled={disabled}
                >
                  <Pencil className="size-3.5" />
                </Button>
              ),
            }
          : {})}
        popoverClassName={
          layout === "inline"
            ? "w-[min(20rem,calc(100vw-1rem))] p-0 [&_[data-slot=command-list]]:max-h-48"
            : "w-[min(28rem,calc(100vw-2rem))] p-0"
        }
        onValueChange={onValueChange}
      />
    </div>
  );
}
