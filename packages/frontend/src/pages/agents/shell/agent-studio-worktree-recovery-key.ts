import {
  type AgentSessionTranscriptState,
  isAgentSessionTranscriptLoading,
} from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";

type WorktreeRecoverySelection = {
  view: {
    taskId: string;
    selectedTask: {
      status?: string | null;
      updatedAt?: string | null;
    } | null;
    activeSession: {
      externalSessionId: string;
      status: string;
      workingDirectory: string | null;
    } | null;
    transcriptState: AgentSessionTranscriptState;
  };
};

type BuildAgentStudioWorktreeRecoveryKeyArgs = {
  workspaceRepoPath: string | null;
  selection: WorktreeRecoverySelection;
  isForegroundLoadingTasks: boolean;
};

export const buildAgentStudioWorktreeRecoveryKey = ({
  workspaceRepoPath,
  selection,
  isForegroundLoadingTasks,
}: BuildAgentStudioWorktreeRecoveryKeyArgs): string =>
  [
    workspaceRepoPath ?? "",
    selection.view.taskId ?? "",
    selection.view.selectedTask?.updatedAt ?? "",
    selection.view.selectedTask?.status ?? "",
    selection.view.activeSession?.externalSessionId ?? "",
    selection.view.activeSession?.status ?? "",
    selection.view.activeSession?.workingDirectory ?? "",
    isAgentSessionTranscriptLoading(selection.view.transcriptState) ? "1" : "0",
    isForegroundLoadingTasks ? "1" : "0",
  ].join(":");
