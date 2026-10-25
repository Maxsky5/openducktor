import { useMemo } from "react";
import { agentSessionIdentityKey } from "../../lib/agent-session-identity";
import { resolveAgentPendingInputParticipants } from "../agent-session-pending-input-participants";
import type { AgentSessionPendingInputSummary } from "../agent-session-snapshots";
import { useAgentPendingInputSessions } from "../session-store-hooks";
import type {
  AgentApprovalRequest,
  AgentQuestionRequest,
  AgentSessionIdentity,
} from "../../types/agent-orchestrator";

const EMPTY_PENDING_COUNTS: Record<string, number> = Object.freeze({});
type PendingInputRequest = AgentApprovalRequest | AgentQuestionRequest;

/** The pending approvals and questions of each Subagent session, by session identity key. */
export type SubagentPendingInputCounts = {
  readonly approvals: Record<string, number>;
  readonly questions: Record<string, number>;
};

const getChildSession = (
  sessionIdentity: AgentSessionIdentity | null,
  request: PendingInputRequest,
): AgentSessionIdentity | null => {
  if (request.source?.kind !== "subagent") {
    return null;
  }
  if (request.responseSession) {
    return request.responseSession;
  }
  if (!sessionIdentity) {
    return null;
  }
  return resolveAgentPendingInputParticipants(sessionIdentity, request).subagentChildSession;
};

/**
 * Counts the pending input of each session: the count that a child session reports, and the
 * requests that the parent mirrors for its Subagent sessions.
 */
export const countSubagentPendingInput = (
  sessions: readonly AgentSessionPendingInputSummary[],
  readCount: (session: AgentSessionPendingInputSummary) => number,
  sessionIdentity: AgentSessionIdentity | null,
  requests: readonly PendingInputRequest[],
): Record<string, number> => {
  const counts: Record<string, number> = {};
  const keepLargerCount = (key: string, count: number): void => {
    counts[key] = Math.max(counts[key] ?? 0, count);
  };
  for (const session of sessions) {
    const count = readCount(session);
    if (count > 0) {
      keepLargerCount(agentSessionIdentityKey(session), count);
    }
  }

  const requestCounts = new Map<string, number>();
  for (const request of requests) {
    const childSession = getChildSession(sessionIdentity, request);
    if (!childSession) {
      continue;
    }
    const sessionKey = agentSessionIdentityKey(childSession);
    const count = requestCounts.get(sessionKey) ?? 0;
    requestCounts.set(sessionKey, count + 1);
  }
  // Parent requests can mirror child requests, so keep the larger count instead of adding them.
  for (const [sessionKey, count] of requestCounts) {
    keepLargerCount(sessionKey, count);
  }
  return Object.keys(counts).length > 0 ? counts : EMPTY_PENDING_COUNTS;
};

/**
 * The pending input of the Subagent sessions of a parent session. The transcript Subagent cards
 * and a Subagents list read the same counts.
 */
export const useSubagentPendingInputCounts = ({
  sessionIdentity,
  pendingApprovals,
  pendingQuestions,
}: {
  sessionIdentity: AgentSessionIdentity | null;
  pendingApprovals: readonly AgentApprovalRequest[];
  pendingQuestions: readonly AgentQuestionRequest[];
}): SubagentPendingInputCounts => {
  const sessions = useAgentPendingInputSessions();
  const approvals = useMemo(
    () =>
      countSubagentPendingInput(
        sessions,
        (summary) => summary.pendingApprovalCount,
        sessionIdentity,
        pendingApprovals,
      ),
    [sessions, sessionIdentity, pendingApprovals],
  );
  const questions = useMemo(
    () =>
      countSubagentPendingInput(
        sessions,
        (summary) => summary.pendingQuestionCount,
        sessionIdentity,
        pendingQuestions,
      ),
    [sessions, sessionIdentity, pendingQuestions],
  );
  return useMemo(() => ({ approvals, questions }), [approvals, questions]);
};
