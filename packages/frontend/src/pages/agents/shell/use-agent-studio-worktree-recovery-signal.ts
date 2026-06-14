import { useState } from "react";
import {
  isSelectedAgentSessionViewLoading,
  type SelectedAgentSessionViewLifecycle,
} from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";

type WorktreeRecoverySelection = {
  viewTaskId: string;
  viewSelectedTask: {
    status?: string | null;
    updatedAt?: string | null;
  } | null;
  viewActiveSession: {
    externalSessionId: string;
    status: string;
    workingDirectory: string | null;
  } | null;
  viewSessionLifecycle: SelectedAgentSessionViewLifecycle;
};

type UseAgentStudioWorktreeRecoverySignalArgs = {
  workspaceRepoPath: string | null;
  selection: WorktreeRecoverySelection;
  isForegroundLoadingTasks: boolean;
};

export function useAgentStudioWorktreeRecoverySignal({
  workspaceRepoPath,
  selection,
  isForegroundLoadingTasks,
}: UseAgentStudioWorktreeRecoverySignalArgs): number {
  const nextRecoveryKey = [
    workspaceRepoPath ?? "",
    selection.viewTaskId ?? "",
    selection.viewSelectedTask?.updatedAt ?? "",
    selection.viewSelectedTask?.status ?? "",
    selection.viewActiveSession?.externalSessionId ?? "",
    selection.viewActiveSession?.status ?? "",
    selection.viewActiveSession?.workingDirectory ?? "",
    isSelectedAgentSessionViewLoading(selection.viewSessionLifecycle) ? "1" : "0",
    isForegroundLoadingTasks ? "1" : "0",
  ].join(":");
  const [worktreeRecoveryState, setWorktreeRecoveryState] = useState({
    key: null as string | null,
    signal: 0,
  });

  if (worktreeRecoveryState.key === null) {
    setWorktreeRecoveryState({ key: nextRecoveryKey, signal: 0 });
  } else if (worktreeRecoveryState.key !== nextRecoveryKey) {
    setWorktreeRecoveryState({
      key: nextRecoveryKey,
      signal: worktreeRecoveryState.signal + 1,
    });
  }

  return worktreeRecoveryState.signal;
}
