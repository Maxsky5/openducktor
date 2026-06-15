import {
  type AgentSessionViewLifecycle,
  isAgentSessionTranscriptLoading,
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
  viewSessionLifecycle: AgentSessionViewLifecycle;
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
    isAgentSessionTranscriptLoading(selection.viewSessionLifecycle.transcriptState) ? "1" : "0",
    isForegroundLoadingTasks ? "1" : "0",
  ].join(":");
