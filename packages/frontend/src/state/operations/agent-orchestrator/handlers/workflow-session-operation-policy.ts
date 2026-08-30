import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { toPersistedSessionRecord } from "../support/persistence";

type PersistSessionRecord = (taskId: string, record: AgentSessionRecord) => Promise<void>;

export type CommitSessionModelChange = (session: AgentSessionState) => Promise<void>;

export const createCommitSessionModelChangePolicy = ({
  persistSessionRecord,
}: {
  persistSessionRecord: PersistSessionRecord;
}): CommitSessionModelChange => {
  return async (session): Promise<void> => {
    if (session.sessionAssociation.kind === "repository") {
      return;
    }
    if (session.sessionAssociation.kind === "unbound") {
      throw new Error(
        `Cannot persist model change for unbound session '${session.externalSessionId}'.`,
      );
    }
    await persistSessionRecord(
      session.sessionAssociation.taskId,
      toPersistedSessionRecord(session),
    );
  };
};

export type CommitStoppedSession = (session: AgentSessionState, repoPath: string) => Promise<void>;

export const createCommitStoppedSessionPolicy = ({
  persistSessionRecord,
  invalidateSessionStopQueries,
  refreshTaskData,
}: {
  persistSessionRecord: PersistSessionRecord;
  invalidateSessionStopQueries: (input: { repoPath: string; taskId: string }) => Promise<void>;
  refreshTaskData: (repoPath: string, taskIdOrIds?: string | string[]) => Promise<void>;
}): CommitStoppedSession => {
  return async (session, repoPath): Promise<void> => {
    if (session.sessionAssociation.kind !== "workflow") {
      return;
    }

    const taskId = session.sessionAssociation.taskId;
    await persistSessionRecord(taskId, toPersistedSessionRecord(session));
    await Promise.all([
      invalidateSessionStopQueries({ repoPath, taskId }),
      refreshTaskData(repoPath, taskId),
    ]);
  };
};
