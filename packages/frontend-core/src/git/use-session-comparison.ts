import {
  type GitComparisonTarget,
  type GitTargetBranch,
  UPSTREAM_TARGET_BRANCH,
} from "@openducktor/contracts";
import {
  type QueryClient,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useId, useState } from "react";
import { connectionHost } from "../connection/client-connection";
import { errorMessage } from "../lib/errors";
import { targetBranchSelectionValue } from "../lib/target-branch";
import {
  continuedCheckoutRead,
  gitComparisonTargetQueryOptions,
  gitQueryKeys,
  invalidateRepoBranchesQuery,
} from "../queries/git";
import { renewWorkspaceReadContext } from "../queries/workspace-refresh";
import type { GitRefreshComparison } from "./refresh/git-refresh-coordinator";

export type SessionComparisonInput = {
  enabled: boolean;
  viewKey: string;
  repoPath: string;
  workingDirectory: string | null;
  target: GitTargetBranch | null;
  targetError: string | null;
  branchKey: string;
  /** The checkout of the branch key. A rebase step continues the shown comparison. */
  checkoutIdentity: string | null;
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
  const comparisonOptions = gitComparisonTargetQueryOptions(
    input.repoPath,
    input.workingDirectory ?? "__missing_directory__",
    input.target ?? { branch: "HEAD" },
    input.branchKey,
  );
  const comparison = useQuery({
    ...comparisonOptions,
    ...continuedCheckoutRead(comparisonOptions.queryKey, input.checkoutIdentity),
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
    target.branch === UPSTREAM_TARGET_BRANCH ? target.branch : targetBranchSelectionValue(target);
  return {
    // Fetch also updates the current branch's upstream when the comparison target is fixed.
    fetchKey: JSON.stringify([repoPath, workingDirectory, targetBranch, branchKey]),
    fetch: async (force) => {
      const result = await connectionHost(queryClient).gitFetchRemote(repoPath, targetBranch, {
        force,
        workingDir: workingDirectory,
      });
      renewWorkspaceReadContext(queryClient, workingDirectory);
      // A recent host fetch can be newer than the branch list, so only no remote skips the read.
      if (result.outcome === "skipped_no_remote") return;
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
