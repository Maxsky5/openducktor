import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { resolveAgentPendingInputParticipants } from "@/state/agent-session-pending-input-participants";
import type {
  AgentApprovalRequest,
  AgentQuestionRequest,
  AgentSessionIdentity,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import { type ReadSessionSnapshot, requireWorkspaceRepoPath } from "../support/session-invariants";
import type { SessionTurnMetadata } from "../support/session-turn-metadata";

export type PendingInputActionDependencies = {
  workspaceRepoPath: string | null;
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
  currentSession: AgentSessionIdentity;
  request: AgentApprovalRequest | AgentQuestionRequest;
}): {
  responseSession: AgentSessionIdentity;
  turnContextSession: AgentSessionState | null;
} => {
  const { responseSession, sessions } = resolveAgentPendingInputParticipants(
    currentSession,
    request,
  );
  const loadedResponseSession = readSessionSnapshot(responseSession);
  const contextSession =
    loadedResponseSession ??
    sessions.map((session) => readSessionSnapshot(session)).find((session) => session !== null) ??
    null;
  return {
    responseSession,
    turnContextSession: contextSession
      ? {
          ...contextSession,
          externalSessionId: responseSession.externalSessionId,
          runtimeKind: responseSession.runtimeKind,
          workingDirectory: responseSession.workingDirectory,
        }
      : null,
  };
};

const replyRepoPath = (
  workspaceRepoPath: string | null,
  identity: AgentSessionIdentity,
): string => {
  if ("repoPath" in identity && typeof identity.repoPath === "string") {
    return identity.repoPath;
  }
  return requireWorkspaceRepoPath(workspaceRepoPath);
};

export const createPendingInputActions = (dependencies: PendingInputActionDependencies) => {
  const replyAgentApproval = async (
    identity: AgentSessionIdentity,
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
    await dependencies.liveSessionHost.agentSessionLiveReplyApproval({
      repoPath: replyRepoPath(dependencies.workspaceRepoPath, identity),
      externalSessionId: responseSession.externalSessionId,
      runtimeKind: responseSession.runtimeKind,
      workingDirectory: responseSession.workingDirectory,
      requestId: request.requestId,
      outcome,
      ...(message ? { message } : {}),
    });
  };

  const answerAgentQuestion = async (
    identity: AgentSessionIdentity,
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
      repoPath: replyRepoPath(dependencies.workspaceRepoPath, identity),
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
