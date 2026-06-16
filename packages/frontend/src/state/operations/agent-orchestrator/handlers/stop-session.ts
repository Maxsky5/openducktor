import type {
  AgentSessionRecord,
  AgentSessionStopTarget,
  RuntimeKind,
} from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { settleDanglingTodoToolMessages } from "../agent-tool-messages";
import { now } from "../support/core";
import { appendSessionMessage } from "../support/messages";
import { toPersistedSessionRecord } from "../support/persistence";
import {
  buildUserStoppedNoticeMessage,
  USER_STOPPED_NOTICE,
} from "../support/session-notice-messages";
import type { SessionObservers } from "../support/session-observers";
import { toRuntimeSessionRef } from "../support/session-runtime-ref";
import {
  clearSessionTransientState,
  type SessionTransientState,
} from "../support/session-transient-state";
import { isWorkflowAgentSession } from "../support/workflow-session";

type ReadSessionSnapshot = (identity: AgentSessionIdentity) => AgentSessionState | null;
type UpdateSession = (
  identity: AgentSessionIdentity,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => AgentSessionState | null;

export type StopAgentSessionDependencies = {
  workspaceRepoPath: string | null;
  adapter: Pick<AgentEnginePort, "releaseSession">;
  readSessionSnapshot: ReadSessionSnapshot;
  updateSession: UpdateSession;
  sessionObserversRef: { current: SessionObservers };
  sessionTransientState: SessionTransientState;
  persistSessionRecord: (taskId: string, record: AgentSessionRecord) => Promise<void>;
  stopAuthoritativeSession: (target: AgentSessionStopTarget) => Promise<void>;
  invalidateSessionStopQueries: (input: {
    repoPath: string;
    taskId: string;
    runtimeKind?: RuntimeKind;
  }) => Promise<void>;
  refreshTaskData: (
    repoPath: string,
    taskIdOrIds?: string | string[],
    options?: { forceFreshTaskList?: boolean },
  ) => Promise<void>;
  loadAgentSessions: (taskId: string) => Promise<void>;
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
  sessionObserversRef,
  sessionTransientState,
  persistSessionRecord,
  stopAuthoritativeSession,
  invalidateSessionStopQueries,
  refreshTaskData,
  loadAgentSessions,
}: StopAgentSessionDependencies) => {
  return async (identity: AgentSessionIdentity): Promise<void> => {
    const session = readSessionSnapshot(identity);
    if (!session) {
      return;
    }
    const externalSessionId = session.externalSessionId;
    let stopRepoPath: string | null = null;

    updateSession(
      session,
      (current) => ({
        ...current,
        stopRequestedAt: now(),
      }),
      { persist: false },
    );

    try {
      stopRepoPath = workspaceRepoPath;
      if (!stopRepoPath) {
        throw new Error("Active workspace repo path is unavailable.");
      }

      await stopAuthoritativeSession({
        repoPath: stopRepoPath,
        taskId: session.taskId,
        externalSessionId,
        runtimeKind: session.runtimeKind,
        workingDirectory: session.workingDirectory,
      });
    } catch (error) {
      updateSession(
        session,
        (current) => ({
          ...current,
          stopRequestedAt: null,
        }),
        { persist: false },
      );
      throw new Error(
        `Failed to stop ${session.role} session '${externalSessionId}': ${errorMessage(error)}`,
      );
    }

    const stoppedSessionRef = toRuntimeSessionRef(stopRepoPath, session);
    try {
      await adapter.releaseSession(stoppedSessionRef);
    } catch (error) {
      console.warn(
        `Failed to release local session '${externalSessionId}' after authoritative stop: ${errorMessage(error)}`,
      );
    }

    sessionObserversRef.current.remove(stoppedSessionRef);
    clearSessionTransientState(sessionTransientState, stoppedSessionRef);

    const stoppedAt = now();
    const nextStoppedSession = updateSession(session, (current) => {
      const shouldAppendUserStoppedNotice = Boolean(current.stopRequestedAt);
      return {
        ...current,
        status: "stopped",
        messages: shouldAppendUserStoppedNotice
          ? appendUserStoppedNotice(current, stoppedAt)
          : current.messages,
        draftAssistantText: "",
        draftAssistantMessageId: null,
        draftReasoningText: "",
        draftReasoningMessageId: null,
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
      loadAgentSessions(session.taskId),
    ]);
  };
};
