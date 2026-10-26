import type { GitCurrentBranch } from "@openducktor/contracts";
import { sessionComparisonOptions } from "@openducktor/frontend-core/git/session-comparison-options";
import {
  targetBranchFromSelection,
  targetBranchSelectionValue,
} from "@openducktor/frontend-core/lib/target-branch";
import { repoBranchesQueryOptions } from "@openducktor/frontend-core/queries/git";
import { useQuery } from "@tanstack/react-query";
import { type ReactElement, useMemo } from "react";
import { BranchPickerSheet } from "@/features/branches/branch-picker-sheet";
import type { WorkOwnerComparisonChoice } from "@/features/work-owner/work-owner-context";

/**
 * The comparison branch choice of Changes, as the desktop Git panel target control: the
 * repository branches, the current target, and the tracked upstream where it applies.
 */
export function ComparisonBranchPicker({
  repoPath,
  choice,
  checkout,
  visible,
  onClose,
}: {
  repoPath: string;
  choice: WorkOwnerComparisonChoice;
  /** The checkout of the compared directory. Its branch is no comparison choice. */
  checkout: GitCurrentBranch | null;
  visible: boolean;
  onClose: () => void;
}): ReactElement {
  const branches = useQuery({ ...repoBranchesQueryOptions(repoPath), enabled: visible });
  const { target, allowUpstream, apply } = choice;
  const checkoutBranch = checkout && !checkout.detached ? (checkout.name ?? null) : null;
  const choices = useMemo(
    () =>
      branches.data
        ? sessionComparisonOptions(branches.data, target, { allowUpstream, checkoutBranch })
        : undefined,
    [allowUpstream, branches.data, checkoutBranch, target],
  );
  const { refetch } = branches;
  return (
    <BranchPickerSheet
      visible={visible}
      title="Comparison Branch"
      hint={choice.hint}
      choices={choices}
      error={branches.error}
      onRetry={() => void refetch()}
      selected={target ? targetBranchSelectionValue(target) : null}
      onSelect={(value) => apply(targetBranchFromSelection(value))}
      onClose={onClose}
    />
  );
}
