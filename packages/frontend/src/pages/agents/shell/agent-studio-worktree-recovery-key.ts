import {
  type AgentSessionTranscriptState,
  isAgentSessionTranscriptLoading,
} from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";

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
  viewTranscriptState: AgentSessionTranscriptState;
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
    selection.viewTaskId ?? "",
    selection.viewSelectedTask?.updatedAt ?? "",
    selection.viewSelectedTask?.status ?? "",
    selection.viewActiveSession?.externalSessionId ?? "",
    selection.viewActiveSession?.status ?? "",
    selection.viewActiveSession?.workingDirectory ?? "",
    isAgentSessionTranscriptLoading(selection.viewTranscriptState) ? "1" : "0",
    isForegroundLoadingTasks ? "1" : "0",
  ].join(":");
