import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import type { AgentEnginePort, PolicyBoundSessionRef } from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { resolveAgentPendingInputParticipants } from "@/state/agent-session-pending-input-participants";
import type {
  AgentApprovalRequest,
  AgentQuestionRequest,
  AgentSessionIdentity,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import type { UpdateSession } from "../events/session-event-types";
import { applyQuestionAnswerToSession } from "../support/question-messages";
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

type PendingInputReplyContext = {
  runtimeSession: AgentSessionState;
  loadedSessionsToUpdate: AgentSessionState[];
};

const isPolicyBoundSessionRef = (session: AgentSessionIdentity): session is PolicyBoundSessionRef =>
  "repoPath" in session && "runtimePolicy" in session;

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

const resolvePolicyBoundPendingInputReplyContext = ({
  readSessionSnapshot,
  currentSession,
  request,
}: {
  readSessionSnapshot: ReadSessionSnapshot;
  currentSession: PolicyBoundSessionRef;
  request: AgentApprovalRequest | AgentQuestionRequest;
}): { runtimeSessionRef: PolicyBoundSessionRef; loadedSessionsToUpdate: AgentSessionState[] } => {
  const { responseSession, sessions } = resolveAgentPendingInputParticipants(
    currentSession,
    request,
  );
  if (responseSession.runtimeKind !== currentSession.runtimeKind) {
    throw new Error(
      `Cannot reply to '${responseSession.externalSessionId}' through a '${currentSession.runtimeKind}' runtime policy.`,
    );
  }
  const runtimeSessionRef: PolicyBoundSessionRef = { ...currentSession };
  runtimeSessionRef.externalSessionId = responseSession.externalSessionId;
  runtimeSessionRef.workingDirectory = responseSession.workingDirectory;
  return {
    runtimeSessionRef,
    loadedSessionsToUpdate: readUniqueLoadedSessions(readSessionSnapshot, sessions),
  };
};

const removeResolvedApproval = (
  updateSession: UpdateSession,
  sessions: readonly AgentSessionState[],
  requestId: string,
): void => {
  for (const session of sessions) {
    updateSession(session, (current) => ({
      ...current,
      pendingApprovals: current.pendingApprovals.filter((entry) => entry.requestId !== requestId),
    }));
  }
};

const applyResolvedQuestion = (
  updateSession: UpdateSession,
  sessions: readonly AgentSessionState[],
  requestId: string,
  answers: string[][],
): void => {
  for (const session of sessions) {
    updateSession(session, (current) => {
      const { pendingQuestions, messages } = applyQuestionAnswerToSession(
        current,
        requestId,
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

export const createPendingInputActions = (dependencies: PendingInputActionDependencies) => {
  const replyAgentApproval = async (
    identity: AgentSessionIdentity,
    request: AgentApprovalRequest,
    outcome: RuntimeApprovalReplyOutcome,
    message?: string,
  ): Promise<void> => {
    if (isPolicyBoundSessionRef(identity)) {
      const { runtimeSessionRef, loadedSessionsToUpdate } =
        resolvePolicyBoundPendingInputReplyContext({
          readSessionSnapshot: dependencies.readSessionSnapshot,
          currentSession: identity,
          request,
        });
      await dependencies.adapter.replyApproval({
        ...runtimeSessionRef,
        requestId: request.requestId,
        outcome,
        ...(message ? { message } : {}),
      });
      removeResolvedApproval(dependencies.updateSession, loadedSessionsToUpdate, request.requestId);
      return;
    }
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

    removeResolvedApproval(dependencies.updateSession, loadedSessionsToUpdate, request.requestId);
  };

  const answerAgentQuestion = async (
    identity: AgentSessionIdentity,
    request: AgentQuestionRequest,
    answers: string[][],
  ): Promise<void> => {
    if (isPolicyBoundSessionRef(identity)) {
      const { runtimeSessionRef, loadedSessionsToUpdate } =
        resolvePolicyBoundPendingInputReplyContext({
          readSessionSnapshot: dependencies.readSessionSnapshot,
          currentSession: identity,
          request,
        });
      await dependencies.adapter.replyQuestion({
        ...runtimeSessionRef,
        requestId: request.requestId,
        answers,
      });
      applyResolvedQuestion(
        dependencies.updateSession,
        loadedSessionsToUpdate,
        request.requestId,
        answers,
      );
      return;
    }
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

    applyResolvedQuestion(
      dependencies.updateSession,
      loadedSessionsToUpdate,
      request.requestId,
      answers,
    );
  };

  return {
    replyAgentApproval,
    answerAgentQuestion,
  };
};
