import type { GitCurrentBranch } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useEffectEvent, useRef } from "react";
import type { AppVisibility } from "../../platform/app-visibility";
import { invalidateWorkspaceFileQueries } from "../../queries/filesystem";
import {
  checkoutReadIdentity,
  currentBranchQueryOptions,
  gitQueryKeys,
  invalidateCurrentBranchQuery,
  loadCurrentBranchFromQuery,
  worktreeBranchQueryOptions,
} from "../../queries/git";

/**
 * The checkout of a workspace session directory. A worktree reads its own branch. The repository
 * root uses the workspace branch that `activeBranch` gives. A return to the app reads a worktree
 * branch again.
 */
export function useWorkspaceSessionBranch({
  repoPath,
  workingDirectory,
  isWorktree,
  isSwitchingBranch,
  activeBranch,
  visibility,
}: {
  repoPath: string;
  workingDirectory: string | null;
  isWorktree: boolean;
  isSwitchingBranch: boolean;
  activeBranch: GitCurrentBranch | null;
  visibility: AppVisibility;
}) {
  const queryClient = useQueryClient();
  const rootBranch = useQuery({ ...currentBranchQueryOptions(repoPath), enabled: false });
  const worktreeBranch = useQuery({
    ...worktreeBranchQueryOptions(repoPath, workingDirectory ?? ""),
    enabled: isWorktree && workingDirectory !== null,
    staleTime: Infinity,
    refetchOnMount: false,
  });
  const { currentBranch, previewBranch, branchKey, branchReady } = branchState(
    isWorktree,
    rootBranch,
    worktreeBranch,
    activeBranch,
  );
  const lastBranch = useRef<string | null>(
    previewBranch && workingDirectory ? JSON.stringify([workingDirectory, previewBranch]) : null,
  );
  useEffect(() => {
    if (!previewBranch || !workingDirectory) return;
    const key = JSON.stringify([workingDirectory, previewBranch]);
    if (!isWorktree && isSwitchingBranch) return;
    if (lastBranch.current === key) return;
    lastBranch.current = key;
    // File queries render their own refresh errors.
    void invalidateWorkspaceFileQueries(queryClient, workingDirectory).catch(() => {});
  }, [isSwitchingBranch, isWorktree, previewBranch, queryClient, workingDirectory]);

  const refreshBranch = useCallback(() => {
    if (isWorktree) {
      if (!workingDirectory) return;
      void queryClient.invalidateQueries({
        queryKey: gitQueryKeys.worktreeBranch(repoPath, workingDirectory),
        exact: true,
      });
      return;
    }
    void invalidateCurrentBranchQuery(queryClient, repoPath);
    // The query holds the error so the preview can show a retry action.
    void loadCurrentBranchFromQuery(queryClient, repoPath).catch(() => {});
  }, [isWorktree, queryClient, repoPath, workingDirectory]);
  const readBranch = useCallback(async (): Promise<string> => {
    if (isWorktree) {
      if (!workingDirectory) return "unknown";
      await queryClient.invalidateQueries({
        queryKey: gitQueryKeys.worktreeBranch(repoPath, workingDirectory),
        exact: true,
        refetchType: "none",
      });
      const next = await queryClient.fetchQuery(
        worktreeBranchQueryOptions(repoPath, workingDirectory),
      );
      return branchKeyFor(next, true);
    }
    await invalidateCurrentBranchQuery(queryClient, repoPath);
    return branchKeyFor(await loadCurrentBranchFromQuery(queryClient, repoPath), false);
  }, [isWorktree, queryClient, repoPath, workingDirectory]);
  const refreshOnFocus = useEffectEvent(() => {
    if (!visibility.isHidden()) refreshBranch();
  });
  useEffect(() => {
    if (!isWorktree || !workingDirectory) return;
    return visibility.subscribe(() => refreshOnFocus());
  }, [isWorktree, visibility, workingDirectory]);

  return {
    currentBranch,
    rootBranch,
    worktreeBranch,
    previewBranch,
    branchKey,
    branchReady,
    refreshBranch,
    readBranch,
  };
}

type BranchRead = {
  data: GitCurrentBranch | undefined;
  isError: boolean;
  isFetching: boolean;
};

function branchState(
  isWorktree: boolean,
  root: BranchRead,
  worktree: BranchRead,
  active: GitCurrentBranch | null,
) {
  const read = isWorktree ? worktree : root;
  const cached = isWorktree ? (worktree.data ?? null) : (root.data ?? active);
  const cachedKey = branchIdentity(cached);
  return {
    currentBranch: read.isError ? null : cached,
    previewBranch: read.isError || read.isFetching ? null : cachedKey,
    branchKey: read.isError ? "unknown" : branchKeyFor(cached, isWorktree),
    branchReady: cachedKey !== null || read.isError,
  };
}

/** The checkout part of the Git read keys. A commit or a rebase step keeps it. */
function branchKeyFor(branch: GitCurrentBranch | null, isWorktree: boolean): string {
  if (isWorktree || branch?.detached) return checkoutReadIdentity(branch) ?? "unknown";
  return branch?.name ?? "unknown";
}

function branchIdentity(branch: GitCurrentBranch | null): string | null {
  if (!branch) return null;
  if (branch.detached) return `detached:${branch.revision ?? "unknown"}`;
  return branch.name != null ? `branch:${branch.name}` : null;
}
