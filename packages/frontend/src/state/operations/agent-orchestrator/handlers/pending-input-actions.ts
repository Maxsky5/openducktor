import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import type { AgentSessionScope } from "@openducktor/core";
import { HostInvokeError, type HostClient } from "@openducktor/host-client";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { resolveAgentPendingInputParticipants } from "@/state/agent-session-pending-input-participants";
import { getAcceptedMessageAfterSendFailure } from "@/state/agent-runtime-services";
import type {
  AgentApprovalRequest,
  AgentQuestionRequest,
  AgentSessionIdentity,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import type { UpdateSession } from "../events/session-event-types";
import { closeBackgroundQuestions } from "../support/background-questions";
import { type ReadSessionSnapshot, requireWorkspaceRepoPath } from "../support/session-invariants";
import type { SessionTurnMetadata } from "../support/session-turn-metadata";

export type PendingInputActionDependencies = {
  workspaceRepoPath: string | null;
  liveSessionHost: Pick<
    HostClient,
    "agentSessionLiveReplyApproval" | "agentSessionLiveReplyQuestion"
  >;
  readSessionSnapshot: ReadSessionSnapshot;
  updateSession: UpdateSession;
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
  session: AgentSessionIdentity,
  selectedModel: AgentSessionState["selectedModel"],
): void => {
  const sessionKey = agentSessionIdentityKey(session);
  if (dependencies.readTurnUserMessageStartedAtMs(sessionKey) === undefined) {
    dependencies.recordTurnUserMessageTimestamp(sessionKey, Date.now());
  }
  dependencies.turnMetadata.recordModel(sessionKey, selectedModel);
};

const preparePendingInputReply = ({
  dependencies,
  currentSession,
  request,
}: {
  dependencies: PendingInputActionDependencies;
  currentSession: AgentSessionIdentity;
  request: AgentApprovalRequest | AgentQuestionRequest;
}) => {
  const participants = resolveAgentPendingInputParticipants(currentSession, request);
  const { responseSession } = participants;
  const responseState = dependencies.readSessionSnapshot(responseSession);
  if (!responseState && !request.responseSession) {
    throw new Error(
      `Cannot reply to pending input for session '${responseSession.externalSessionId}' because its repository context is unavailable.`,
    );
  }

  if (responseState) {
    markTurnUserAnchorIfMissing(dependencies, responseSession, responseState.selectedModel);
  }
  return participants;
};

export const createPendingInputActions = (dependencies: PendingInputActionDependencies) => {
  const replyAgentApproval = async (
    identity: AgentSessionIdentity,
    request: AgentApprovalRequest,
    outcome: RuntimeApprovalReplyOutcome,
    message?: string,
  ): Promise<void> => {
    const { responseSession } = preparePendingInputReply({
      dependencies,
      currentSession: identity,
      request,
    });
    const input: Parameters<typeof dependencies.liveSessionHost.agentSessionLiveReplyApproval>[0] =
      {
        repoPath: requireWorkspaceRepoPath(dependencies.workspaceRepoPath),
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
    identity: AgentSessionIdentity,
    request: AgentQuestionRequest,
    answers: string[][],
    sessionScope?: AgentSessionScope,
  ): Promise<void> => {
    const { responseSession, sessions } = preparePendingInputReply({
      dependencies,
      currentSession: identity,
      request,
    });
    const input: Parameters<typeof dependencies.liveSessionHost.agentSessionLiveReplyQuestion>[0] =
      {
        repoPath: requireWorkspaceRepoPath(dependencies.workspaceRepoPath),
        externalSessionId: responseSession.externalSessionId,
        runtimeKind: responseSession.runtimeKind,
        workingDirectory: responseSession.workingDirectory,
        requestId: request.requestId,
        answers,
      };
    if (request.blocking !== undefined) input.blocking = request.blocking;
    if (sessionScope !== undefined) input.sessionScope = sessionScope;
    try {
      await dependencies.liveSessionHost.agentSessionLiveReplyQuestion(input);
    } catch (error) {
      const repoPath = requireWorkspaceRepoPath(dependencies.workspaceRepoPath);
      const acceptedMessage =
        error instanceof HostInvokeError
          ? getAcceptedMessageAfterSendFailure(error, { ...responseSession, repoPath })
          : null;
      if (!acceptedMessage) throw error;

      const handledRequestIds = acceptedMessage.resolvedQuestionRequestIds ?? [request.requestId];
      for (const session of sessions) {
        dependencies.updateSession(session, (current) => ({
          ...current,
          ...closeBackgroundQuestions(current, handledRequestIds),
        }));
      }
    }
  };

  return {
    replyAgentApproval,
    answerAgentQuestion,
  };
};
