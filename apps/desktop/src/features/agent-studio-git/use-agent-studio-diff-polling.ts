import { useEffect } from "react";

const POLL_INTERVAL_MS = 30_000;

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

    const intervalId = globalThis.setInterval(() => {
      poll();
    }, POLL_INTERVAL_MS);

    return () => {
      globalThis.clearInterval(intervalId);
    };
  }, [enablePolling, poll, repoPath, shouldBlockDiffLoading]);
}
