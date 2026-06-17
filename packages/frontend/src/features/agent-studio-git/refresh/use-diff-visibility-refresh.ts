import { useEffect } from "react";

type UseAgentStudioDiffVisibilityRefreshArgs = {
  enableScheduledRefresh: boolean;
  repoPath: string | null;
  shouldBlockDiffLoading: boolean;
  refresh: () => void;
};

export function useAgentStudioDiffVisibilityRefresh({
  enableScheduledRefresh,
  refresh,
  repoPath,
  shouldBlockDiffLoading,
}: UseAgentStudioDiffVisibilityRefreshArgs): void {
  useEffect(() => {
    if (!enableScheduledRefresh || !repoPath || shouldBlockDiffLoading) {
      return;
    }

    const refreshWhenVisible = (): void => {
      if (globalThis.document.visibilityState !== "visible") {
        return;
      }

      refresh();
    };

    globalThis.addEventListener("focus", refreshWhenVisible);
    globalThis.document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      globalThis.removeEventListener("focus", refreshWhenVisible);
      globalThis.document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [enableScheduledRefresh, refresh, repoPath, shouldBlockDiffLoading]);
}
