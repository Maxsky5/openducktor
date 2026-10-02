import type { GitCurrentBranch } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useEffectEvent, useRef } from "react";
import { invalidateWorkspaceFileQueries } from "@/state/queries/filesystem";
import {
  currentBranchQueryOptions,
  gitQueryKeys,
  invalidateCurrentBranchQuery,
  loadCurrentBranchFromQuery,
  worktreeBranchQueryOptions,
} from "@/state/queries/git";

export function useWorkspaceSessionBranch({
  repoPath,
  workingDirectory,
  isWorktree,
  isSwitchingBranch,
  activeBranch,
}: {
  repoPath: string;
  workingDirectory: string | null;
  isWorktree: boolean;
  isSwitchingBranch: boolean;
  activeBranch: GitCurrentBranch | null;
}) {
  const queryClient = useQueryClient();
  const rootBranch = useQuery({ ...currentBranchQueryOptions(repoPath), enabled: false });
  const worktreeBranch = useQuery({
    ...worktreeBranchQueryOptions(repoPath, workingDirectory ?? ""),
    enabled: isWorktree && workingDirectory !== null,
  });
  const { previewBranch, branchKey, branchReady } = branchState(
    isWorktree,
    rootBranch,
    worktreeBranch,
    activeBranch,
  );
  const lastBranch = useRef<string | null>(null);
  useEffect(() => {
    if (!previewBranch || !workingDirectory) return;
    const key = JSON.stringify([workingDirectory, previewBranch]);
    if (lastBranch.current === key) return;
    lastBranch.current = key;
    if (!isWorktree && isSwitchingBranch) return;
    void invalidateWorkspaceFileQueries(queryClient, workingDirectory);
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
    if (document.visibilityState === "visible") refreshBranch();
  });
  useEffect(() => {
    if (!isWorktree || !workingDirectory) return;
    const onFocus = () => refreshOnFocus();
    globalThis.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      globalThis.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [isWorktree, workingDirectory]);

  return {
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
    previewBranch: read.isError || read.isFetching ? null : cachedKey,
    branchKey: read.isError ? "unknown" : branchKeyFor(cached, isWorktree),
    branchReady: cachedKey !== null || read.isError,
  };
}

function branchKeyFor(branch: GitCurrentBranch | null, isWorktree: boolean): string {
  if (isWorktree) return branchIdentity(branch) ?? "unknown";
  return branch?.name ?? (branch?.detached ? "detached" : "unknown");
}

function branchIdentity(branch: GitCurrentBranch | null): string | null {
  if (!branch) return null;
  if (branch.detached) return `detached:${branch.revision ?? "unknown"}`;
  return branch.name != null ? `branch:${branch.name}` : null;
}
