import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { toPersistedSessionRecord } from "../support/persistence";

type PersistSessionRecord = (
  repoPath: string,
  taskId: string,
  record: AgentSessionRecord,
) => Promise<void>;

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
      session.repoPath,
      session.sessionAssociation.taskId,
      toPersistedSessionRecord(session),
    );
  };
};

export type CommitStoppedSession = (session: AgentSessionState) => Promise<void>;

export const createCommitStoppedSessionPolicy = ({
  persistSessionRecord,
  invalidateSessionStopQueries,
  refreshTaskData,
}: {
  persistSessionRecord: PersistSessionRecord;
  invalidateSessionStopQueries: (input: { repoPath: string; taskId: string }) => Promise<void>;
  refreshTaskData: (repoPath: string, taskIdOrIds?: string | string[]) => Promise<void>;
}): CommitStoppedSession => {
  return async (session): Promise<void> => {
    if (session.sessionAssociation.kind !== "workflow") {
      return;
    }

    const taskId = session.sessionAssociation.taskId;
    const repoPath = session.repoPath;
    await persistSessionRecord(repoPath, taskId, toPersistedSessionRecord(session));
    await Promise.all([
      invalidateSessionStopQueries({ repoPath, taskId }),
      refreshTaskData(repoPath, taskId),
    ]);
  };
};
