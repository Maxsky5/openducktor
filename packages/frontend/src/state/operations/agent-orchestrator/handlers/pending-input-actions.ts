import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { resolveAgentPendingInputParticipants } from "@/state/agent-session-pending-input-participants";
import type {
  AgentApprovalRequest,
  AgentQuestionRequest,
  AgentSessionIdentity,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import type { UpdateSession } from "../events/session-event-types";
import { annotateQuestionToolMessage } from "../support/question-messages";
import { type ReadSessionSnapshot, requireWorkspaceRepoPath } from "../support/session-invariants";
import type { LoadSettingsSnapshotForRuntimePolicy } from "../support/session-runtime-policy";
import { resolveRuntimeSessionContextRef } from "../support/session-runtime-policy";
import type { SessionTurnMetadata } from "../support/session-turn-metadata";

export type PendingInputActionDependencies = {
  workspaceRepoPath: string | null;
  adapter: Pick<AgentEnginePort, "replyApproval" | "replyQuestion">;
  readSessionSnapshot: ReadSessionSnapshot;
  updateSession: UpdateSession;
  turnMetadata: SessionTurnMetadata;
  recordTurnUserMessageTimestamp: (
    sessionKey: string,
    timestamp: string | number,
  ) => number | undefined;
  readTurnUserMessageStartedAtMs: (sessionKey: string) => number | undefined;
  loadSettingsSnapshot: LoadSettingsSnapshotForRuntimePolicy;
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

const applyQuestionAnswerToSession = (
  session: AgentSessionState,
  requestId: string,
  answers: string[][],
): Pick<AgentSessionState, "pendingQuestions" | "messages"> => {
  const answeredRequest = session.pendingQuestions.find((entry) => entry.requestId === requestId);
  const pendingQuestions = session.pendingQuestions.filter(
    (entry) => entry.requestId !== requestId,
  );
  if (!answeredRequest || answeredRequest.questions.length === 0) {
    return {
      pendingQuestions,
      messages: session.messages,
    };
  }

  const answeredQuestionsWithAnswers = answeredRequest.questions.map((question, index) => ({
    ...question,
    answers: answers[index] ?? [],
  }));
  return {
    pendingQuestions,
    messages: annotateQuestionToolMessage(
      session,
      requestId,
      answeredQuestionsWithAnswers,
      answers,
    ),
  };
};

type PendingInputReplyContext = {
  runtimeSession: AgentSessionState;
  loadedSessionsToUpdate: AgentSessionState[];
};

const readUniqueLoadedSessions = (
  readSessionSnapshot: ReadSessionSnapshot,
  identities: readonly AgentSessionIdentity[],
): AgentSessionState[] => {
  const sessions = new Map<string, AgentSessionState>();
  for (const identity of identities) {
    const session = readSessionSnapshot(identity);
    if (session) {
      sessions.set(agentSessionIdentityKey(session), session);
    }
  }
  return Array.from(sessions.values());
};

const resolvePendingInputReplyContext = ({
  readSessionSnapshot,
  currentSession,
  request,
}: {
  readSessionSnapshot: ReadSessionSnapshot;
  currentSession: AgentSessionIdentity;
  request: AgentApprovalRequest | AgentQuestionRequest;
}): PendingInputReplyContext => {
  const { responseSession, sessions } = resolveAgentPendingInputParticipants(
    currentSession,
    request,
  );
  const loadedResponseSession = readSessionSnapshot(responseSession);
  const loadedParticipantSessions = readUniqueLoadedSessions(readSessionSnapshot, sessions);
  const contextSession = loadedResponseSession ?? loadedParticipantSessions[0] ?? null;

  if (!contextSession) {
    throw new Error(`Session '${responseSession.externalSessionId}' is not loaded.`);
  }

  const runtimeSession: AgentSessionState = {
    ...contextSession,
    externalSessionId: responseSession.externalSessionId,
    runtimeKind: responseSession.runtimeKind,
    workingDirectory: responseSession.workingDirectory,
  };

  return {
    runtimeSession,
    loadedSessionsToUpdate: loadedParticipantSessions,
  };
};

export const createPendingInputActions = (dependencies: PendingInputActionDependencies) => {
  const replyAgentApproval = async (
    identity: AgentSessionIdentity,
    request: AgentApprovalRequest,
    outcome: RuntimeApprovalReplyOutcome,
    message?: string,
  ): Promise<void> => {
    const { runtimeSession, loadedSessionsToUpdate } = resolvePendingInputReplyContext({
      readSessionSnapshot: dependencies.readSessionSnapshot,
      currentSession: identity,
      request,
    });
    markTurnUserAnchorIfMissing(dependencies, runtimeSession);
    const repoPath = requireWorkspaceRepoPath(dependencies.workspaceRepoPath);
    const runtimeSessionRef = await resolveRuntimeSessionContextRef(
      repoPath,
      runtimeSession,
      dependencies.loadSettingsSnapshot,
    );
    await dependencies.adapter.replyApproval({
      ...runtimeSessionRef,
      requestId: request.requestId,
      outcome,
      ...(message ? { message } : {}),
    });

    for (const session of loadedSessionsToUpdate) {
      dependencies.updateSession(session, (current) => ({
        ...current,
        pendingApprovals: current.pendingApprovals.filter(
          (entry) => entry.requestId !== request.requestId,
        ),
      }));
    }
  };

  const answerAgentQuestion = async (
    identity: AgentSessionIdentity,
    request: AgentQuestionRequest,
    answers: string[][],
  ): Promise<void> => {
    const { runtimeSession, loadedSessionsToUpdate } = resolvePendingInputReplyContext({
      readSessionSnapshot: dependencies.readSessionSnapshot,
      currentSession: identity,
      request,
    });
    markTurnUserAnchorIfMissing(dependencies, runtimeSession);
    const repoPath = requireWorkspaceRepoPath(dependencies.workspaceRepoPath);
    const runtimeSessionRef = await resolveRuntimeSessionContextRef(
      repoPath,
      runtimeSession,
      dependencies.loadSettingsSnapshot,
    );
    await dependencies.adapter.replyQuestion({
      ...runtimeSessionRef,
      requestId: request.requestId,
      answers,
    });

    for (const session of loadedSessionsToUpdate) {
      dependencies.updateSession(session, (current) => {
        const { pendingQuestions, messages } = applyQuestionAnswerToSession(
          current,
          request.requestId,
          answers,
        );

        return {
          ...current,
          pendingQuestions,
          messages,
        };
      });
    }
  };

  return {
    replyAgentApproval,
    answerAgentQuestion,
  };
};
