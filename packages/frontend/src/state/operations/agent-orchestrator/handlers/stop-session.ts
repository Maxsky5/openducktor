import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { settleDanglingTodoToolMessages } from "../agent-tool-messages";
import type { UpdateSession } from "../events/session-event-types";
import { now } from "../support/core";
import { appendSessionMessage } from "../support/messages";
import { toPersistedSessionRecord } from "../support/persistence";
import { type ReadSessionSnapshot, requireWorkspaceRepoPath } from "../support/session-invariants";
import {
  buildUserStoppedNoticeMessage,
  USER_STOPPED_NOTICE,
} from "../support/session-notice-messages";
import { toRuntimeSessionRef } from "../support/session-runtime-ref";
import { isWorkflowAgentSession } from "../support/workflow-session";

export type StopAgentSessionDependencies = {
  workspaceRepoPath: string | null;
  adapter: Pick<AgentEnginePort, "stopSession">;
  readSessionSnapshot: ReadSessionSnapshot;
  updateSession: UpdateSession;
  clearSessionTurnState: (session: AgentSessionIdentity) => void;
  persistSessionRecord: (taskId: string, record: AgentSessionRecord) => Promise<void>;
  invalidateSessionStopQueries: (input: { repoPath: string; taskId: string }) => Promise<void>;
  refreshTaskData: (repoPath: string, taskIdOrIds?: string | string[]) => Promise<void>;
};

const appendUserStoppedNotice = (
  session: AgentSessionState,
  timestamp: string,
): AgentSessionState["messages"] =>
  appendSessionMessage(
    {
      externalSessionId: session.externalSessionId,
      messages: settleDanglingTodoToolMessages(session, timestamp, {
        outcome: "error",
        errorMessage: USER_STOPPED_NOTICE,
      }),
    },
    buildUserStoppedNoticeMessage(timestamp),
  );

export const createStopAgentSession = ({
  workspaceRepoPath,
  adapter,
  readSessionSnapshot,
  updateSession,
  clearSessionTurnState,
  persistSessionRecord,
  invalidateSessionStopQueries,
  refreshTaskData,
}: StopAgentSessionDependencies) => {
  return async (identity: AgentSessionIdentity): Promise<void> => {
    const session = readSessionSnapshot(identity);
    if (!session) {
      return;
    }
    const externalSessionId = session.externalSessionId;
    let stopRepoPath: string | null = null;

    updateSession(session, (current) => ({
      ...current,
      stopRequestedAt: now(),
    }));

    try {
      stopRepoPath = requireWorkspaceRepoPath(workspaceRepoPath);

      await adapter.stopSession(toRuntimeSessionRef(stopRepoPath, session));
    } catch (error) {
      updateSession(session, (current) => ({
        ...current,
        stopRequestedAt: null,
      }));
      throw new Error(
        `Failed to stop ${session.role} session '${externalSessionId}': ${errorMessage(error)}`,
      );
    }

    const stoppedSessionRef = toRuntimeSessionRef(stopRepoPath, session);
    clearSessionTurnState(stoppedSessionRef);

    const stoppedAt = now();
    const nextStoppedSession = updateSession(session, (current) => {
      const shouldAppendUserStoppedNotice = Boolean(current.stopRequestedAt);
      return {
        ...current,
        status: "stopped",
        runtimeStatusMessage: null,
        messages: shouldAppendUserStoppedNotice
          ? appendUserStoppedNotice(current, stoppedAt)
          : current.messages,
        stopRequestedAt: null,
        pendingApprovals: [],
        pendingQuestions: [],
      };
    });

    if (nextStoppedSession && isWorkflowAgentSession(nextStoppedSession)) {
      await persistSessionRecord(
        nextStoppedSession.taskId,
        toPersistedSessionRecord(nextStoppedSession),
      );
    }

    await Promise.all([
      invalidateSessionStopQueries({
        repoPath: stopRepoPath,
        taskId: session.taskId,
      }),
      refreshTaskData(stopRepoPath),
    ]);
  };
};
