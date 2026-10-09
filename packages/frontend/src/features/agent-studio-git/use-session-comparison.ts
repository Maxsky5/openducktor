import type { GitBranch, GitComparisonTarget, GitTargetBranch } from "@openducktor/contracts";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
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
  const activeContext = useRef({ key: contextKey, enabled: input.enabled });
  useLayoutEffect(() => {
    activeContext.current = { key: contextKey, enabled: input.enabled };
  }, [contextKey, input.enabled]);
  const comparison = useQuery({
    ...gitComparisonTargetQueryOptions(
      input.repoPath,
      input.workingDirectory ?? "__missing_directory__",
      input.target ?? { branch: "HEAD" },
      input.branchKey,
    ),
    staleTime: Infinity,
    refetchOnMount: false,
    enabled:
      input.enabled &&
      input.branchReady &&
      input.workingDirectory !== null &&
      input.target !== null &&
      input.targetError === null &&
      !input.branchError,
  });
  const refreshComparison = useComparisonRefresh(
    input,
    contextKey,
    activeContext,
    comparison.refetch,
  );
  return {
    target: input.target,
    refreshComparison,
    contextKey,
    cacheKey: input.branchKey,
    ...comparisonState(input, comparison),
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

/** Share in-flight fetches and keep the scheduled fetch cooldown for this view. */
function useComparisonRefresh(
  input: Pick<SessionComparisonInput, "repoPath" | "workingDirectory" | "target" | "branchKey">,
  contextKey: string,
  activeContext: RefObject<{ key: string; enabled: boolean }>,
  refetch: UseQueryResult<GitComparisonTarget, Error>["refetch"],
) {
  const queryClient = useQueryClient();
  const fetchedAt = useRef(new Map<string, number>());
  const fetches = useRef(new Map<string, Promise<void>>());
  const { repoPath, workingDirectory, target, branchKey } = input;
  return useCallback(
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
      // Fetch also updates the current branch's upstream when the comparison target is fixed.
      const key = JSON.stringify([
        createScheduledFetchCooldownKey({ repoPath, workingDir: workingDirectory, targetBranch }),
        branchKey,
      ]);
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
            if (result.outcome === "fetched") {
              await invalidateRepoBranchesQuery(queryClient, repoPath);
              await queryClient.refetchQueries({
                queryKey: gitQueryKeys.branches(repoPath),
                exact: true,
                type: "active",
              });
            }
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
    [
      repoPath,
      workingDirectory,
      target,
      branchKey,
      refetch,
      contextKey,
      activeContext,
      queryClient,
    ],
  );
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
