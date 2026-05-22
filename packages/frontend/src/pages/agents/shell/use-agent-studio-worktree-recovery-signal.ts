import { useEffect, useRef, useState } from "react";
import type { AgentsPageRouteSessionModel } from "./use-agents-page-route-session-model";

type UseAgentStudioWorktreeRecoverySignalArgs = {
  workspaceRepoPath: string | null;
  selection: AgentsPageRouteSessionModel["selection"];
  isForegroundLoadingTasks: boolean;
};

export function useAgentStudioWorktreeRecoverySignal({
  workspaceRepoPath,
  selection,
  isForegroundLoadingTasks,
}: UseAgentStudioWorktreeRecoverySignalArgs): number {
  const [worktreeRecoverySignal, setWorktreeRecoverySignal] = useState(0);
  const lastWorktreeRecoveryKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const nextRecoveryKey = [
      workspaceRepoPath ?? "",
      selection.viewTaskId ?? "",
      selection.viewSelectedTask?.updatedAt ?? "",
      selection.viewSelectedTask?.status ?? "",
      selection.viewActiveSession?.externalSessionId ?? "",
      selection.viewActiveSession?.status ?? "",
      selection.viewActiveSession?.workingDirectory ?? "",
      selection.isViewSessionHistoryHydrating ? "1" : "0",
      isForegroundLoadingTasks ? "1" : "0",
    ].join(":");

    if (lastWorktreeRecoveryKeyRef.current === null) {
      lastWorktreeRecoveryKeyRef.current = nextRecoveryKey;
      return;
    }

    if (lastWorktreeRecoveryKeyRef.current === nextRecoveryKey) {
      return;
    }

    lastWorktreeRecoveryKeyRef.current = nextRecoveryKey;
    setWorktreeRecoverySignal((previous) => previous + 1);
  }, [
    isForegroundLoadingTasks,
    selection.isViewSessionHistoryHydrating,
    selection.viewActiveSession?.externalSessionId,
    selection.viewActiveSession?.status,
    selection.viewActiveSession?.workingDirectory,
    selection.viewSelectedTask?.status,
    selection.viewSelectedTask?.updatedAt,
    selection.viewTaskId,
    workspaceRepoPath,
  ]);

  return worktreeRecoverySignal;
}
