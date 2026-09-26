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
  activeBranch,
}: {
  repoPath: string;
  workingDirectory: string | null;
  isWorktree: boolean;
  activeBranch: GitCurrentBranch | null;
}) {
  const queryClient = useQueryClient();
  const rootBranch = useQuery({ ...currentBranchQueryOptions(repoPath), enabled: false });
  const worktreeBranch = useQuery({
    ...worktreeBranchQueryOptions(repoPath, workingDirectory ?? ""),
    enabled: isWorktree && workingDirectory !== null,
  });
  const { branch, branchKey } = branchState(isWorktree, rootBranch, worktreeBranch, activeBranch);
  const previewBranch = branchIdentity(branch);
  const lastBranch = useRef<string | null>(null);
  useEffect(() => {
    if (!previewBranch || !workingDirectory || lastBranch.current === previewBranch) return;
    lastBranch.current = previewBranch;
    void invalidateWorkspaceFileQueries(queryClient, workingDirectory);
  }, [previewBranch, queryClient, workingDirectory]);

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

  return { rootBranch, worktreeBranch, previewBranch, branchKey, refreshBranch };
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
  if (isWorktree) {
    return {
      branch: worktree.isError || worktree.isFetching ? null : (worktree.data ?? null),
      branchKey: worktree.isError
        ? "unknown"
        : (branchIdentity(worktree.data ?? null) ?? "unknown"),
    };
  }
  const branch = root.isError || root.isFetching ? null : (root.data ?? active);
  return {
    branch,
    branchKey: branch?.name ?? (branch?.detached ? "detached" : "unknown"),
  };
}

function branchIdentity(branch: GitCurrentBranch | null): string | null {
  if (!branch) return null;
  if (branch.detached) return `detached:${branch.revision ?? "unknown"}`;
  return branch.name != null ? `branch:${branch.name}` : null;
}
