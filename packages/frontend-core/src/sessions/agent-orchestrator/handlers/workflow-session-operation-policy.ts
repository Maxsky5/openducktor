import type { WorkspaceRef } from "@openducktor/contracts";
import type { AgentSessionState } from "../../../types/agent-orchestrator";
import { requireWorkspaceRepoPath } from "../support/session-invariants";

export type RefreshStoppedWorkflowSession = (session: AgentSessionState) => Promise<void>;

export const createRefreshStoppedWorkflowSession = ({
  workspaceRepoPath,
  invalidateSessionStopQueries,
  refreshTaskData,
}: {
  workspaceRepoPath: string | null;
  invalidateSessionStopQueries: (input: {
    workspaceId: string;
    repoPath: string;
    taskId: string;
  }) => Promise<void>;
  refreshTaskData: (scope: WorkspaceRef, taskIdOrIds?: string | string[]) => Promise<void>;
}): RefreshStoppedWorkflowSession => {
  return async (session): Promise<void> => {
    if (session.sessionAssociation.kind !== "workflow") {
      return;
    }

    const taskId = session.sessionAssociation.taskId;
    const repoPath = requireWorkspaceRepoPath(workspaceRepoPath);
    await Promise.all([
      invalidateSessionStopQueries({
        workspaceId: session.sessionAssociation.workspaceId,
        repoPath,
        taskId,
      }),
      refreshTaskData({ workspaceId: session.sessionAssociation.workspaceId, repoPath }, taskId),
    ]);
  };
};
