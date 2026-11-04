import type { GitBranch, GitTargetBranch } from "@openducktor/contracts";
import { targetBranchOptions } from "@openducktor/frontend-core/lib/branch-selector-model";
import {
  targetBranchFromSelection,
  targetBranchSelectionValueOrEmpty,
} from "@openducktor/frontend-core/lib/target-branch";
import { type ReactElement, useId, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { BranchSelector } from "./branch-selector";

type DefaultTargetBranchFieldProps = {
  value: GitTargetBranch | null;
  branches: GitBranch[];
  isLoading: boolean;
  error: string | null;
  disabled: boolean;
  /** Text under the field, such as why Git does not tell the default branch. */
  note?: string | null;
  onRetry: () => void;
  onChange: (targetBranch: GitTargetBranch) => void;
};

/**
 * The Default target branch field of a workspace. The saved branch stays a choice when the branch
 * list does not have it.
 */
export function DefaultTargetBranchField({
  value,
  branches,
  isLoading,
  error,
  disabled,
  note,
  onRetry,
  onChange,
}: DefaultTargetBranchFieldProps): ReactElement {
  const labelId = useId();
  const options = useMemo(() => targetBranchOptions(branches, value), [branches, value]);
  let placeholder = "Select a branch";
  if (isLoading) placeholder = "Loading branches…";
  else if (error) placeholder = "Branches unavailable";

  return (
    <div className="grid gap-2">
      <Label id={labelId}>Default target branch</Label>
      <BranchSelector
        value={targetBranchSelectionValueOrEmpty(value)}
        options={options}
        disabled={disabled || isLoading || options.length === 0}
        placeholder={placeholder}
        searchPlaceholder="Search branches…"
        triggerAriaLabelledBy={labelId}
        onValueChange={(next) => onChange(targetBranchFromSelection(next))}
      />
      {note ? <p className="text-xs text-warning-muted">{note}</p> : null}
      {error ? (
        <div className="flex items-center gap-2">
          <p className="text-xs text-warning-muted">
            Failed to load branches for repository: {error}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            disabled={disabled || isLoading}
            onClick={onRetry}
          >
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  );
}
