import type { GitBranch, GitComparisonTarget, GitTargetBranch } from "@openducktor/contracts";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
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
  repoBranchesQueryOptions,
} from "@/state/queries/git";
import { renewWorkspaceReadContext } from "@/state/queries/workspace-refresh";
import {
  createScheduledFetchCooldownKey,
  shouldRunScheduledFetch,
} from "./refresh/scheduled-fetch-policy";

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

/** A new view needs a fresh check, even when it returns to the same branch and target. */
export function useSessionComparison(input: SessionComparisonInput) {
  const queryClient = useQueryClient();
  const fetchedAt = useRef(new Map<string, number>());
  const fetches = useRef(new Map<string, Promise<void>>());
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
  const activeContext = useRef({ key: contextKey, enabled: input.enabled });
  useLayoutEffect(() => {
    activeContext.current = { key: contextKey, enabled: input.enabled };
  }, [contextKey, input.enabled]);
  const comparison = useQuery({
    ...gitComparisonTargetQueryOptions(
      input.repoPath,
      input.workingDirectory ?? "__missing_directory__",
      input.target ?? { branch: "HEAD" },
      contextKey,
    ),
    enabled:
      input.enabled &&
      input.branchReady &&
      input.workingDirectory !== null &&
      input.target !== null &&
      input.targetError === null &&
      !input.branchError,
  });
  const unavailableReason = comparisonUnavailableReason(input, comparison);
  const resolvedTarget =
    unavailableReason === null && comparison.data?.kind === "available"
      ? comparison.data.reference
      : null;
  const { refetch } = comparison;
  const { repoPath, workingDirectory, target } = input;
  const refreshComparison = useCallback(
    async (mode: "hard" | "soft" | "scheduled" = "soft") => {
      if (
        !workingDirectory ||
        !target ||
        !activeContext.current.enabled ||
        activeContext.current.key !== contextKey
      )
        return null;
      const targetBranch =
        target.branch === "@{upstream}" ? target.branch : targetBranchSelectionValue(target);
      const key = createScheduledFetchCooldownKey({
        repoPath,
        workingDir: workingDirectory,
        targetBranch,
      });
      const fetchDue =
        mode === "scheduled" &&
        shouldRunScheduledFetch({
          lastFetchedAtMs: fetchedAt.current.get(key) ?? null,
          nowMs: Date.now(),
        });
      if (mode === "hard" || fetchDue) {
        let pending = fetches.current.get(key);
        if (!pending) {
          pending = (async () => {
            const result = await hostClient.gitFetchRemote(
              repoPath,
              targetBranch,
              workingDirectory,
            );
            renewWorkspaceReadContext(queryClient, workingDirectory);
            if (result.outcome === "fetched")
              await invalidateRepoBranchesQuery(queryClient, repoPath);
            fetchedAt.current.set(key, Date.now());
          })().finally(() => {
            fetches.current.delete(key);
          });
          fetches.current.set(key, pending);
        }
        await pending;
      }
      // A fetch can outlive the view that started it. Check only the captured view.
      if (!activeContext.current.enabled || activeContext.current.key !== contextKey) return null;
      const checked = await refetch();
      if (checked.isError) throw checked.error;
      return checked.data?.kind === "available" ? checked.data.reference : null;
    },
    [repoPath, workingDirectory, target, refetch, contextKey, queryClient],
  );
  return {
    target: input.target,
    refreshComparison,
    contextKey,
    resolvedTarget,
    unavailableReason,
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
  const options = sessionComparisonOptions(branches.data ?? [], input.target, input.allowUpstream);
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
  const included = selection
    ? [
        {
          value: selection,
          label: target ? canonicalTargetBranch(target) : selection,
          secondaryLabel: "selected",
        },
      ]
    : [];
  if (allowUpstream && selection !== "@{upstream}")
    included.push({ value: "@{upstream}", label: "Tracked upstream", secondaryLabel: "upstream" });
  return toBranchSelectorOptions(branches, { valueFormat: "full_ref", includeOptions: included });
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
