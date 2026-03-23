import { useEffect } from "react";

type UseAgentStudioDiffPollingArgs = {
  enablePolling: boolean;
  repoPath: string | null;
  shouldBlockDiffLoading: boolean;
  poll: () => void;
};

export function useAgentStudioDiffPolling({
  enablePolling,
  poll,
  repoPath,
  shouldBlockDiffLoading,
}: UseAgentStudioDiffPollingArgs): void {
  useEffect(() => {
    if (!enablePolling || !repoPath || shouldBlockDiffLoading) {
      return;
    }

    const refreshWhenVisible = (): void => {
      if (globalThis.document.visibilityState !== "visible") {
        return;
      }

      poll();
    };

    return () => {
      globalThis.removeEventListener("focus", refreshWhenVisible);
      globalThis.document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [enablePolling, poll, repoPath, shouldBlockDiffLoading]);

  useEffect(() => {
    if (!enablePolling || !repoPath || shouldBlockDiffLoading) {
      return;
    }

    const refreshWhenVisible = (): void => {
      if (globalThis.document.visibilityState !== "visible") {
        return;
      }

      poll();
    };

    globalThis.addEventListener("focus", refreshWhenVisible);
    globalThis.document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      globalThis.removeEventListener("focus", refreshWhenVisible);
      globalThis.document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [enablePolling, poll, repoPath, shouldBlockDiffLoading]);
}
