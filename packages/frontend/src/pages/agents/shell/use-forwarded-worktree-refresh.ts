import { useCallback } from "react";
import type { GitDiffRefresh } from "@openducktor/frontend-core/git/contracts";

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
