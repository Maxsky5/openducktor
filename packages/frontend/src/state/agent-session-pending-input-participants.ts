import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type {
  AgentApprovalRequest,
  AgentQuestionRequest,
  AgentSessionIdentity,
} from "@/types/agent-orchestrator";

export type AgentPendingInputRequest = Pick<
  AgentApprovalRequest | AgentQuestionRequest,
  "responseSession" | "source"
>;

export type AgentPendingInputParticipants = {
  responseSession: AgentSessionIdentity;
  sessions: readonly AgentSessionIdentity[];
  subagentChildSession: AgentSessionIdentity | null;
};

export const resolveAgentPendingInputParticipants = (
  currentSession: AgentSessionIdentity,
  request: AgentPendingInputRequest | undefined,
): AgentPendingInputParticipants => {
  const responseSession = request?.responseSession ?? currentSession;
  const sessions = new Map<string, AgentSessionIdentity>();
  const addSession = (session: AgentSessionIdentity): void => {
    sessions.set(agentSessionIdentityKey(session), session);
  };
  const sessionForExternalId = (externalSessionId: string): AgentSessionIdentity => {
    if (currentSession.externalSessionId === externalSessionId) {
      return currentSession;
    }
    if (responseSession.externalSessionId === externalSessionId) {
      return responseSession;
    }
    return toAgentSessionIdentity({
      ...currentSession,
      externalSessionId,
    });
  };

  addSession(currentSession);
  addSession(responseSession);

  if (request?.source?.kind !== "subagent") {
    return {
      responseSession,
      sessions: Array.from(sessions.values()),
      subagentChildSession: null,
    };
  }

  const parentSession = sessionForExternalId(request.source.parentExternalSessionId);
  const childSession = sessionForExternalId(request.source.childExternalSessionId);
  addSession(parentSession);
  addSession(childSession);

  return {
    responseSession,
    sessions: Array.from(sessions.values()),
    subagentChildSession: childSession,
  };
};
