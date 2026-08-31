import type { AgentEnginePort } from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { settleDanglingTodoToolMessages } from "../agent-tool-messages";
import type { UpdateSession } from "../events/session-event-types";
import { now } from "../support/core";
import { appendSessionMessage } from "../support/messages";
import { type ReadSessionSnapshot, requireWorkspaceRepoPath } from "../support/session-invariants";
import {
  buildUserStoppedNoticeMessage,
  USER_STOPPED_NOTICE,
} from "../support/session-notice-messages";
import { requireSessionAssociation, toRuntimeSessionRef } from "../support/session-runtime-ref";
import type { CommitStoppedSession } from "./workflow-session-operation-policy";

export type StopAgentSessionDependencies = {
  workspaceRepoPath: string | null;
  adapter: Pick<AgentEnginePort, "stopSession">;
  readSessionSnapshot: ReadSessionSnapshot;
  updateSession: UpdateSession;
  clearSessionTurnState: (session: AgentSessionIdentity) => void;
  commitStoppedSession: CommitStoppedSession;
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
  commitStoppedSession,
}: StopAgentSessionDependencies) => {
  return async (identity: AgentSessionIdentity): Promise<void> => {
    const session = readSessionSnapshot(identity);
    if (!session) {
      return;
    }
    const externalSessionId = session.externalSessionId;
    requireSessionAssociation(session, "stop");
    const stopRepoPath = requireWorkspaceRepoPath(workspaceRepoPath);

    updateSession(session, (current) => ({
      ...current,
      stopRequestedAt: now(),
    }));

    try {
      await adapter.stopSession(toRuntimeSessionRef(stopRepoPath, session));
    } catch (error) {
      const stoppedSession =
        updateSession(session, (current) => ({
          ...current,
          stopRequestedAt: null,
        })) ?? readSessionSnapshot(session);
      if (stoppedSession?.status === "stopped") {
        await commitStoppedSession(stoppedSession);
      }
      throw new Error(`Failed to stop session '${externalSessionId}': ${errorMessage(error)}`);
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

    if (nextStoppedSession) {
      await commitStoppedSession(nextStoppedSession);
    }
  };
};
