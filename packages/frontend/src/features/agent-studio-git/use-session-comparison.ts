import type { GitBranch, GitComparisonTarget, GitTargetBranch } from "@openducktor/contracts";
import {
  type QueryClient,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useCallback, useId, useMemo, useState } from "react";
import { toBranchSelectorOptions } from "@/components/features/repository/branch-selector-model";
import { hostClient } from "@/lib/host-client";
import { errorMessage } from "@/lib/errors";
import {
  canonicalTargetBranch,
  targetBranchFromSelection,
  targetBranchSelectionValue,
} from "@/lib/target-branch";
import {
  gitComparisonTargetQueryOptions,
  invalidateRepoBranchesQuery,
  gitQueryKeys,
  repoBranchesQueryOptions,
} from "@/state/queries/git";
import { renewWorkspaceReadContext } from "@/state/queries/workspace-refresh";
import type { GitRefreshComparison } from "./refresh/git-refresh-coordinator";

export type SessionComparisonInput = {
  enabled: boolean;
  viewKey: string;
  repoPath: string;
  workingDirectory: string | null;
  target: GitTargetBranch | null;
  targetError: string | null;
  branchKey: string;
  branchReady: boolean;
  branchError?: string | null;
};

/** Cache Git data by branch and target; guard actions by the selected view. */
export function useSessionComparison(input: SessionComparisonInput) {
  const mountId = useId();
  const identity = JSON.stringify([
    input.viewKey,
    input.repoPath,
    input.workingDirectory,
    input.branchKey,
    input.target,
    input.targetError,
    input.branchError,
    input.branchReady,
  ]);
  const [activation, setActivation] = useState({ identity, version: 0 });
  const version = activation.version + (activation.identity === identity ? 0 : 1);
  if (activation.identity !== identity) setActivation({ identity, version });
  const contextKey = JSON.stringify([mountId, version, identity]);
  const queryClient = useQueryClient();
  const comparison = useQuery({
    ...gitComparisonTargetQueryOptions(
      input.repoPath,
      input.workingDirectory ?? "__missing_directory__",
      input.target ?? { branch: "HEAD" },
      input.branchKey,
    ),
    staleTime: Infinity,
    refetchOnMount: false,
    enabled: input.enabled && canCheck(input),
  });
  const state = comparisonState(input, comparison);
  return {
    target: input.target,
    refreshStep: comparisonRefreshStep(queryClient, input, state.resolvedTarget),
    contextKey,
    cacheKey: input.branchKey,
    ...state,
  };
}

const canCheck = (input: SessionComparisonInput): boolean =>
  input.branchReady &&
  input.workingDirectory !== null &&
  input.target !== null &&
  input.targetError === null &&
  !input.branchError;

/** The fetch and target check of this render. Both use its keys, so a late step stays in it. */
function comparisonRefreshStep(
  queryClient: QueryClient,
  input: SessionComparisonInput,
  resolvedTarget: string | null,
): GitRefreshComparison | null {
  const { repoPath, workingDirectory, target, branchKey } = input;
  if (!canCheck(input) || workingDirectory === null || target === null) return null;
  const targetBranch =
    target.branch === "@{upstream}" ? target.branch : targetBranchSelectionValue(target);
  return {
    // Fetch also updates the current branch's upstream when the comparison target is fixed.
    fetchKey: JSON.stringify([repoPath, workingDirectory, targetBranch, branchKey]),
    fetch: async () => {
      const result = await hostClient.gitFetchRemote(repoPath, targetBranch, workingDirectory);
      renewWorkspaceReadContext(queryClient, workingDirectory);
      if (result.outcome !== "fetched") return;
      await invalidateRepoBranchesQuery(queryClient, repoPath);
      await queryClient.refetchQueries({
        queryKey: gitQueryKeys.branches(repoPath),
        exact: true,
        type: "active",
      });
    },
    check: async () => {
      const checked = await queryClient.fetchQuery({
        ...gitComparisonTargetQueryOptions(repoPath, workingDirectory, target, branchKey),
        staleTime: 0,
      });
      return (checked.kind === "available" ? checked.reference : null) !== resolvedTarget;
    },
  };
}

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
    () => sessionComparisonOptions(branches.data ?? [], target, allowUpstream),
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

export function sessionComparisonOptions(
  branches: GitBranch[],
  target: GitTargetBranch | null,
  allowUpstream = false,
) {
  const selection = target ? targetBranchSelectionValue(target) : "";
  const label = target ? canonicalTargetBranch(target) : selection;
  const included = selection
    ? [
        {
          value: selection,
          label: selection === "@{upstream}" ? "Tracked upstream" : label,
          secondaryLabel: "selected",
        },
      ]
    : [];
  if (allowUpstream && selection !== "@{upstream}")
    included.push({ value: "@{upstream}", label: "Tracked upstream", secondaryLabel: "upstream" });
  return toBranchSelectorOptions(branches, { valueFormat: "full_ref", includeOptions: included });
}

function comparisonState(
  input: SessionComparisonInput,
  comparison: UseQueryResult<GitComparisonTarget, Error>,
) {
  const unavailableReason = comparisonUnavailableReason(input, comparison);
  return {
    isPending:
      input.workingDirectory !== null &&
      !input.branchError &&
      !input.targetError &&
      (!input.branchReady || !input.target || comparison.isPending),
    resolvedTarget:
      unavailableReason === null && comparison.data?.kind === "available"
        ? comparison.data.reference
        : null,
    unavailableReason,
  };
}

function comparisonUnavailableReason(
  input: SessionComparisonInput,
  comparison: UseQueryResult<GitComparisonTarget, Error>,
): string | null {
  if (!input.workingDirectory)
    return "The selected working directory is unavailable. Restore the session worktree to use Git tools.";
  if (input.branchError) return input.branchError;
  if (input.targetError) return input.targetError;
  if (!input.branchReady || !input.target || comparison.isPending)
    return input.target
      ? `Checking comparison ${targetBranchSelectionValue(input.target)}...`
      : "Reading the default comparison target...";
  if (comparison.isError) return errorMessage(comparison.error);
  return comparison.data?.kind === "unavailable" ? comparison.data.reason : null;
}
