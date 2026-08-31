import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { resolveAgentPendingInputParticipants } from "@/state/agent-session-pending-input-participants";
import type {
  AgentApprovalRequest,
  AgentPendingInputActionTarget,
  AgentQuestionRequest,
  AgentSessionIdentity,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import type { ReadSessionSnapshot } from "../support/session-invariants";
import type { SessionTurnMetadata } from "../support/session-turn-metadata";

export type PendingInputActionDependencies = {
  liveSessionHost: Pick<
    HostClient,
    "agentSessionLiveReplyApproval" | "agentSessionLiveReplyQuestion"
  >;
  readSessionSnapshot: ReadSessionSnapshot;
  turnMetadata: SessionTurnMetadata;
  recordTurnUserMessageTimestamp: (
    sessionKey: string,
    timestamp: string | number,
  ) => number | undefined;
  readTurnUserMessageStartedAtMs: (sessionKey: string) => number | undefined;
};

type ResolvedPendingInputRuntimeSession = {
  responseSession: AgentSessionIdentity & Pick<AgentSessionState, "repoPath">;
  turnContextSession: AgentSessionState | null;
};

const markTurnUserAnchorIfMissing = (
  dependencies: Pick<
    PendingInputActionDependencies,
    "recordTurnUserMessageTimestamp" | "readTurnUserMessageStartedAtMs" | "turnMetadata"
  >,
  session: AgentSessionState,
): void => {
  const sessionKey = agentSessionIdentityKey(session);
  if (dependencies.readTurnUserMessageStartedAtMs(sessionKey) === undefined) {
    dependencies.recordTurnUserMessageTimestamp(sessionKey, Date.now());
  }
  dependencies.turnMetadata.recordModel(sessionKey, session.selectedModel ?? null);
};

const resolvePendingInputRuntimeSession = ({
  readSessionSnapshot,
  currentSession,
  request,
}: {
  readSessionSnapshot: ReadSessionSnapshot;
  currentSession: AgentPendingInputActionTarget;
  request: AgentApprovalRequest | AgentQuestionRequest;
}): ResolvedPendingInputRuntimeSession => {
  const { responseSession, sessions } = resolveAgentPendingInputParticipants(
    currentSession,
    request,
  );
  const loadedResponseSession = readSessionSnapshot(responseSession);
  const contextSession =
    loadedResponseSession ??
    sessions.map((session) => readSessionSnapshot(session)).find((session) => session !== null) ??
    null;
  const callerRepoPath = "repoPath" in currentSession ? currentSession.repoPath : null;
  const repoPath = contextSession?.repoPath ?? callerRepoPath;
  if (!repoPath) {
    throw new Error(
      `Cannot reply to pending input for session '${responseSession.externalSessionId}' because its repository context is unavailable.`,
    );
  }
  return {
    responseSession: { ...responseSession, repoPath },
    turnContextSession: contextSession
      ? {
          ...contextSession,
          externalSessionId: responseSession.externalSessionId,
          runtimeKind: responseSession.runtimeKind,
          workingDirectory: responseSession.workingDirectory,
          sessionAssociation:
            request.responseSession?.sessionAssociation ??
            loadedResponseSession?.sessionAssociation ??
            contextSession.sessionAssociation,
        }
      : null,
  };
};

export const createPendingInputActions = (dependencies: PendingInputActionDependencies) => {
  const replyAgentApproval = async (
    identity: AgentPendingInputActionTarget,
    request: AgentApprovalRequest,
    outcome: RuntimeApprovalReplyOutcome,
    message?: string,
  ): Promise<void> => {
    const { responseSession, turnContextSession } = resolvePendingInputRuntimeSession({
      readSessionSnapshot: dependencies.readSessionSnapshot,
      currentSession: identity,
      request,
    });
    if (turnContextSession) {
      markTurnUserAnchorIfMissing(dependencies, turnContextSession);
    }
    const input: Parameters<typeof dependencies.liveSessionHost.agentSessionLiveReplyApproval>[0] =
      {
        repoPath: responseSession.repoPath,
        externalSessionId: responseSession.externalSessionId,
        runtimeKind: responseSession.runtimeKind,
        workingDirectory: responseSession.workingDirectory,
        requestId: request.requestId,
        outcome,
      };
    if (message) {
      input.message = message;
    }
    await dependencies.liveSessionHost.agentSessionLiveReplyApproval(input);
  };

  const answerAgentQuestion = async (
    identity: AgentPendingInputActionTarget,
    request: AgentQuestionRequest,
    answers: string[][],
  ): Promise<void> => {
    const { responseSession, turnContextSession } = resolvePendingInputRuntimeSession({
      readSessionSnapshot: dependencies.readSessionSnapshot,
      currentSession: identity,
      request,
    });
    if (turnContextSession) {
      markTurnUserAnchorIfMissing(dependencies, turnContextSession);
    }
    await dependencies.liveSessionHost.agentSessionLiveReplyQuestion({
      repoPath: responseSession.repoPath,
      externalSessionId: responseSession.externalSessionId,
      runtimeKind: responseSession.runtimeKind,
      workingDirectory: responseSession.workingDirectory,
      requestId: request.requestId,
      answers,
    });
  };

  return {
    replyAgentApproval,
    answerAgentQuestion,
  };
};
