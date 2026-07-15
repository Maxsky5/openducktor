import {
  agentSessionIdentityKey,
  matchesAgentSessionIdentity,
  toAgentSessionIdentity,
} from "@/lib/agent-session-identity";
import { pendingInputIdentity } from "@/lib/pending-input-identity";
import type {
  AgentApprovalRequest,
  AgentQuestionRequest,
  AgentSessionIdentity,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import type { AgentSessionCollection } from "./agent-session-collection";
import { getAgentSession } from "./agent-session-collection";

export type AgentSessionVisiblePendingInput = {
  pendingApprovals: readonly AgentApprovalRequest[];
  pendingQuestions: readonly AgentQuestionRequest[];
};

export const EMPTY_AGENT_SESSION_VISIBLE_PENDING_INPUT: AgentSessionVisiblePendingInput =
  Object.freeze({
    pendingApprovals: Object.freeze([]) as readonly AgentApprovalRequest[],
    pendingQuestions: Object.freeze([]) as readonly AgentQuestionRequest[],
  });

type PendingInputRequest = AgentApprovalRequest | AgentQuestionRequest;

const isMirroredSubagentRequestForSession = (
  ownerSession: AgentSessionState,
  request: PendingInputRequest,
  target: AgentSessionIdentity,
): boolean => {
  if (
    request.source?.kind !== "subagent" ||
    request.source.childExternalSessionId !== target.externalSessionId
  ) {
    return false;
  }

  const inferredChildSession = toAgentSessionIdentity({
    ...ownerSession,
    externalSessionId: request.source.childExternalSessionId,
  });
  return matchesAgentSessionIdentity(request.responseSession ?? inferredChildSession, target);
};

const isPendingInputVisibleForSession = (
  ownerSession: AgentSessionState,
  request: PendingInputRequest,
  target: AgentSessionIdentity,
): boolean =>
  matchesAgentSessionIdentity(request.responseSession, target) ||
  isMirroredSubagentRequestForSession(ownerSession, request, target);

const addRequests = <Request extends PendingInputRequest>(
  requestsById: Map<string, Request>,
  requests: readonly Request[],
): void => {
  for (const request of requests) {
    const requestIdentity = pendingInputIdentity(request);
    if (!requestsById.has(requestIdentity)) {
      requestsById.set(requestIdentity, request);
    }
  }
};

const addVisibleRequests = <Request extends PendingInputRequest>(
  requestsById: Map<string, Request>,
  requests: readonly Request[],
  targetRequestIds: ReadonlySet<string>,
  ownerSession: AgentSessionState,
  target: AgentSessionIdentity,
): void => {
  for (const request of requests) {
    if (
      !targetRequestIds.has(request.requestId) &&
      !requestsById.has(pendingInputIdentity(request)) &&
      isPendingInputVisibleForSession(ownerSession, request, target)
    ) {
      requestsById.set(pendingInputIdentity(request), request);
    }
  }
};

export const getAgentSessionVisiblePendingInput = (
  collection: AgentSessionCollection,
  identity: AgentSessionIdentity | null | undefined,
): AgentSessionVisiblePendingInput => {
  if (!identity) {
    return EMPTY_AGENT_SESSION_VISIBLE_PENDING_INPUT;
  }

  const targetKey = agentSessionIdentityKey(identity);
  const pendingApprovalsById = new Map<string, AgentApprovalRequest>();
  const pendingQuestionsById = new Map<string, AgentQuestionRequest>();
  const targetSession = getAgentSession(collection, identity);

  if (targetSession) {
    addRequests(pendingApprovalsById, targetSession.pendingApprovals);
    addRequests(pendingQuestionsById, targetSession.pendingQuestions);
  }
  const targetApprovalRequestIds = new Set(
    targetSession?.pendingApprovals.map((request) => request.requestId) ?? [],
  );
  const targetQuestionRequestIds = new Set(
    targetSession?.pendingQuestions.map((request) => request.requestId) ?? [],
  );

  for (const session of collection.values()) {
    if (agentSessionIdentityKey(session) === targetKey) {
      continue;
    }
    addVisibleRequests(
      pendingApprovalsById,
      session.pendingApprovals,
      targetApprovalRequestIds,
      session,
      identity,
    );
    addVisibleRequests(
      pendingQuestionsById,
      session.pendingQuestions,
      targetQuestionRequestIds,
      session,
      identity,
    );
  }

  if (pendingApprovalsById.size === 0 && pendingQuestionsById.size === 0) {
    return EMPTY_AGENT_SESSION_VISIBLE_PENDING_INPUT;
  }

  return {
    pendingApprovals: Array.from(pendingApprovalsById.values()),
    pendingQuestions: Array.from(pendingQuestionsById.values()),
  };
};
