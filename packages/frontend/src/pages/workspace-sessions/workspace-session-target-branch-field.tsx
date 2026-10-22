import {
  type GitBranch,
  type GitTargetBranch,
  effectiveWorkspaceSessionTargetBranch,
  type WorkspaceSessionCreateInput,
  workspaceSessionAllowsTargetBranch,
} from "@openducktor/contracts";
import type { UseQueryResult } from "@tanstack/react-query";
import { type ReactElement, useState } from "react";
import { BranchSelector } from "@/components/features/repository/branch-selector";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { sessionComparisonOptions } from "@/features/agent-studio-git/use-session-comparison";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import {
  targetBranchFromSelection,
  targetBranchSelectionValue,
} from "@openducktor/frontend-core/lib/target-branch";

type Location = WorkspaceSessionCreateInput["location"];

/**
 * Holds the work location and the target together, so a location change can drop a pick that
 * the new location cannot use. The target then falls back to the repository default.
 */
export function useWorkspaceSessionLocationTarget(defaultTarget: GitTargetBranch | null) {
  const [choice, setChoice] = useState<{ location: Location; picked: GitTargetBranch | null }>({
    location: "local_repo_root",
    picked: null,
  });
  const { location, picked } = choice;
  return {
    location,
    targetBranch: effectiveWorkspaceSessionTargetBranch(location, picked, defaultTarget),
    changeLocation: (next: Location) =>
      setChoice((current) => ({ location: next, picked: usablePick(next, current.picked) })),
    pickTarget: (target: GitTargetBranch) =>
      setChoice((current) => ({ ...current, picked: target })),
  };
}

function usablePick(location: Location, picked: GitTargetBranch | null) {
  return picked && workspaceSessionAllowsTargetBranch(location, picked) ? picked : null;
}

type Props = {
  value: GitTargetBranch | null;
  defaultTarget: GitTargetBranch | null;
  allowUpstream: boolean;
  branches: UseQueryResult<GitBranch[]>;
  disabled: boolean;
  onChange: (value: GitTargetBranch) => void;
};

/** Offers the builder branch list. The selected target stays listed when the list fails. */
export function WorkspaceSessionTargetBranchField({
  value,
  defaultTarget,
  allowUpstream,
  branches,
  disabled,
  onChange,
}: Props): ReactElement {
  const options = sessionComparisonOptions(branches.data ?? [], value, {
    allowUpstream,
    defaultTarget,
  });
  return (
    <div className="grid gap-1.5">
      <Label id="workspace-session-target-branch">Target branch</Label>
      <BranchSelector
        triggerAriaLabelledBy="workspace-session-target-branch"
        value={value ? targetBranchSelectionValue(value) : ""}
        options={options}
        placeholder={branches.isPending ? "Loading branches…" : "Select a target branch"}
        disabled={disabled}
        onValueChange={(selection) => onChange(targetBranchFromSelection(selection))}
      />
      <p className="text-xs text-muted-foreground">
        The Git panel and diffs of this chat compare with this branch.
      </p>
      {branches.isError && (
        <div role="alert">
          <p className="text-sm text-destructive">{errorMessage(branches.error)}</p>
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => void branches.refetch()}
          >
            Retry branches
          </Button>
        </div>
      )}
    </div>
  );
}
