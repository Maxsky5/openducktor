import type { GitCurrentBranch } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useEffectEvent, useRef } from "react";
import { invalidateWorkspaceFileQueries } from "@/state/queries/filesystem";
import { gitQueryKeys, worktreeBranchQueryOptions } from "@/state/queries/git";

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
  const worktreeBranch = useQuery({
    ...worktreeBranchQueryOptions(repoPath, workingDirectory ?? ""),
    enabled: isWorktree && workingDirectory !== null,
  });
  const branch = isWorktree
    ? worktreeBranch.isError || worktreeBranch.isFetching
      ? null
      : (worktreeBranch.data ?? null)
    : activeBranch;
  const previewBranch = branchIdentity(branch);
  const branchKey = isWorktree
    ? worktreeBranch.isError
      ? "unknown"
      : (branchIdentity(worktreeBranch.data ?? null) ?? "unknown")
    : (activeBranch?.name ?? (activeBranch?.detached ? "detached" : "unknown"));
  const lastBranch = useRef<string | null>(null);
  useEffect(() => {
    if (!previewBranch || !workingDirectory || lastBranch.current === previewBranch) return;
    lastBranch.current = previewBranch;
    void invalidateWorkspaceFileQueries(queryClient, workingDirectory);
  }, [previewBranch, queryClient, workingDirectory]);

  const refreshWorktreeBranch = useCallback(() => {
    if (!isWorktree || !workingDirectory) return;
    void queryClient.invalidateQueries({
      queryKey: gitQueryKeys.worktreeBranch(repoPath, workingDirectory),
      exact: true,
    });
  }, [isWorktree, queryClient, repoPath, workingDirectory]);
  const refreshOnFocus = useEffectEvent(() => {
    if (document.visibilityState === "visible") refreshWorktreeBranch();
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

  return { worktreeBranch, previewBranch, branchKey, refreshWorktreeBranch };
}

function branchIdentity(branch: GitCurrentBranch | null): string | null {
  if (!branch) return null;
  if (branch.detached) return `detached:${branch.revision ?? "unknown"}`;
  return branch.name != null ? `branch:${branch.name}` : null;
}
