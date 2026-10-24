import type {
  WorkspaceSessionLocation,
  WorkspaceSessionWorktreesListResult,
} from "@openducktor/contracts";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { type ReactElement, useState } from "react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { workspaceSessionWorktreesQueryOptions } from "@openducktor/frontend-core/queries/workspace-sessions";

type Worktrees = UseQueryResult<WorkspaceSessionWorktreesListResult>;

/** Holds the selected worktree and reads the worktrees only while the selector shows. */
export function useExistingWorktreeChoice(
  workspaceId: string,
  open: boolean,
  location: WorkspaceSessionLocation,
) {
  const worktrees = useQuery({
    ...workspaceSessionWorktreesQueryOptions(workspaceId),
    enabled: open && location === "existing_worktree",
  });
  const [selected, setSelected] = useState<string | null>(null);
  const isSelectedListed =
    worktrees.data?.worktrees.some((entry) => entry.workingDirectory === selected) ?? false;
  // A pending or failed read cannot confirm that the selected worktree still exists.
  const isReadDone = worktrees.isSuccess && !worktrees.isFetching;
  return {
    selected,
    select: setSelected,
    worktrees,
    isSelectedListed,
    /** The selected worktree once the latest finished read lists it, else null. */
    listedWorktree: isReadDone && isSelectedListed ? selected : null,
    isSelectedUnavailable: selected !== null && isReadDone && !isSelectedListed,
  };
}

type Props = {
  choice: ReturnType<typeof useExistingWorktreeChoice>;
  onChange: (workingDirectory: string) => void;
  disabled: boolean;
};

/** Lists the registered worktrees of the repository. The user must pick one explicitly. */
export function WorkspaceSessionExistingWorktreeField({
  choice,
  onChange,
  disabled,
}: Props): ReactElement {
  const view = existingWorktreeView(choice);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="grid gap-1.5">
        <Label id="workspace-session-existing-worktree">Worktree</Label>
        <Combobox
          triggerAriaLabelledBy="workspace-session-existing-worktree"
          triggerAriaDescribedBy="workspace-session-existing-worktree-hint"
          value={choice.selected ?? ""}
          options={view.options}
          placeholder={view.placeholder}
          searchPlaceholder="Search worktrees..."
          emptyText="No worktree found."
          wrapLabels
          disabled={disabled || !view.selectable}
          onValueChange={onChange}
        />
        <p id="workspace-session-existing-worktree-hint" className="text-xs text-muted-foreground">
          Chats that use this worktree share its files and branch.
        </p>
      </div>
      <ExistingWorktreeStatus
        worktrees={choice.worktrees}
        isEmpty={view.isEmpty}
        isSelectedUnavailable={choice.isSelectedUnavailable}
        disabled={disabled}
      />
    </div>
  );
}

function ExistingWorktreeStatus({
  worktrees,
  isEmpty,
  isSelectedUnavailable,
  disabled,
}: {
  worktrees: Worktrees;
  isEmpty: boolean;
  isSelectedUnavailable: boolean;
  disabled: boolean;
}): ReactElement {
  return (
    <>
      {isEmpty && (
        <p role="status" className="text-sm text-muted-foreground">
          No other worktrees exist for this repository. Use New worktree to create one.
        </p>
      )}
      {worktrees.isError && (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-sm text-destructive">
            Could not load worktrees. {errorMessage(worktrees.error)}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || worktrees.isFetching}
            onClick={() => void worktrees.refetch()}
          >
            Retry worktrees
          </Button>
        </div>
      )}
      {isSelectedUnavailable && (
        <p role="alert" className="break-words text-sm text-destructive">
          The selected worktree is no longer available. Select another worktree.
        </p>
      )}
    </>
  );
}

function existingWorktreeView({
  worktrees,
  selected,
  isSelectedListed,
}: ReturnType<typeof useExistingWorktreeChoice>) {
  const entries = worktrees.data?.worktrees ?? [];
  const isEmpty = worktrees.isSuccess && entries.length === 0;
  const options: ComboboxOption[] = entries.map((entry) => ({
    value: entry.workingDirectory,
    label: entry.workingDirectory,
    description: entry.branchName ?? "Detached HEAD",
  }));
  // Keep the choice visible after a refresh removes it, so the user sees what to correct.
  if (selected !== null && !isSelectedListed) {
    options.push({
      value: selected,
      label: selected,
      description: "No longer available",
      disabled: true,
    });
  }
  return {
    options,
    isEmpty,
    selectable: worktrees.isSuccess && !isEmpty,
    placeholder: worktrees.isPending ? "Loading worktrees…" : "Select a worktree",
  };
}
