import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { toPersistedSessionRecord } from "../support/persistence";
import { requireWorkspaceRepoPath } from "../support/session-invariants";

type PersistSessionRecord = (taskId: string, record: AgentSessionRecord) => Promise<void>;

export type CommitSessionModelChange = (session: AgentSessionState) => Promise<void>;

export const createCommitSessionModelChangePolicy = ({
  persistSessionRecord,
}: {
  persistSessionRecord: PersistSessionRecord;
}): CommitSessionModelChange => {
  return async (session): Promise<void> => {
    if (session.sessionAssociation.kind !== "workflow") {
      return;
    }
    await persistSessionRecord(
      session.sessionAssociation.taskId,
      toPersistedSessionRecord(session),
    );
  };
};

export type CommitStoppedSession = (session: AgentSessionState) => Promise<void>;

export const createCommitStoppedSessionPolicy = ({
  workspaceRepoPath,
  persistSessionRecord,
  invalidateSessionStopQueries,
  refreshTaskData,
}: {
  workspaceRepoPath: string | null;
  persistSessionRecord: PersistSessionRecord;
  invalidateSessionStopQueries: (input: { repoPath: string; taskId: string }) => Promise<void>;
  refreshTaskData: (repoPath: string, taskIdOrIds?: string | string[]) => Promise<void>;
}): CommitStoppedSession => {
  return async (session): Promise<void> => {
    if (session.sessionAssociation.kind !== "workflow") {
      return;
    }

    const taskId = session.sessionAssociation.taskId;
    const repoPath = requireWorkspaceRepoPath(workspaceRepoPath);
    await persistSessionRecord(taskId, toPersistedSessionRecord(session));
    await Promise.all([
      invalidateSessionStopQueries({ repoPath, taskId }),
      refreshTaskData(repoPath, taskId),
    ]);
  };
};
