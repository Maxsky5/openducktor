import { useCallback } from "react";
import type { GitDiffRefresh } from "@/features/agent-studio-git";

export type WorktreeRefreshRef = {
  current: GitDiffRefresh | null;
};

export function useForwardedWorktreeRefresh(
  refreshWorktreeRef: WorktreeRefreshRef,
): GitDiffRefresh {
  return useCallback<GitDiffRefresh>(
    (mode) => {
      return refreshWorktreeRef.current?.(mode) ?? Promise.resolve();
    },
    [refreshWorktreeRef],
  );
}
