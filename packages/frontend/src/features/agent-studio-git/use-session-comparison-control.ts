import type { GitTargetBranch } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { sessionComparisonOptions } from "@openducktor/frontend-core/git/session-comparison-options";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import {
  targetBranchFromSelection,
  targetBranchSelectionValue,
} from "@openducktor/frontend-core/lib/target-branch";
import { repoBranchesQueryOptions } from "@openducktor/frontend-core/queries/git";

/** Task and workspace adapters save choices. This control reads branches and keeps full refs. */
export function useSessionComparisonControl(input: {
  repoPath: string;
  target: GitTargetBranch | null;
  editable: boolean;
  allowUpstream?: boolean;
  helpText?: string;
  applyTarget: (target: GitTargetBranch) => Promise<void>;
}) {
  const branches = useQuery({
    ...repoBranchesQueryOptions(input.repoPath),
    enabled: input.editable,
  });
  const selectionValue = input.target ? targetBranchSelectionValue(input.target) : "";
  const { target, allowUpstream } = input;
  const options = useMemo(
    () => sessionComparisonOptions(branches.data ?? [], target, { allowUpstream }),
    [allowUpstream, branches.data, target],
  );
  const { refetch } = branches;
  const retryBranches = useCallback(async () => {
    const result = await refetch();
    if (result.isError) throw result.error;
  }, [refetch]);
  const { applyTarget } = input;
  const onUpdateTargetBranch = useCallback(
    async (selection: string) => {
      if (!selection.trim()) throw new Error("Choose a comparison branch.");
      await applyTarget(targetBranchFromSelection(selection));
    },
    [applyTarget],
  );
  return {
    targetBranchEditable: input.editable,
    targetBranchOptions: options,
    targetBranchSelectionValue: selectionValue,
    targetBranchHelpText: input.helpText,
    targetBranchesPending: branches.isPending && input.editable,
    targetBranchesError: branches.isError ? errorMessage(branches.error) : null,
    retryTargetBranches: retryBranches,
    onUpdateTargetBranch: input.editable ? onUpdateTargetBranch : undefined,
  };
}
