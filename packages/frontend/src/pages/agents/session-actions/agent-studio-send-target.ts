import type { SessionStartWorkflowResult } from "@/features/session-start";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

type AgentStudioSendTargetInput = {
  selectedSessionIdentity: AgentSessionIdentity | null;
  canStartNewSession: boolean;
};

export type StartSessionForMessage = (options: {
  holdForPostStartMessage: true;
}) => Promise<SessionStartWorkflowResult | undefined>;

type ResolveAgentStudioSendTargetInput = AgentStudioSendTargetInput & {
  startSession: StartSessionForMessage;
};

export const canResolveAgentStudioSendTargetSession = ({
  selectedSessionIdentity,
  canStartNewSession,
}: AgentStudioSendTargetInput): boolean => selectedSessionIdentity !== null || canStartNewSession;

export const resolveAgentStudioSendTargetSession = async ({
  selectedSessionIdentity,
  canStartNewSession,
  startSession,
}: ResolveAgentStudioSendTargetInput): Promise<AgentSessionIdentity | null> => {
  if (selectedSessionIdentity !== null) {
    return selectedSessionIdentity;
  }

  if (!canStartNewSession) {
    return null;
  }

  const startedSession = await startSession({ holdForPostStartMessage: true });
  return startedSession ? toAgentSessionIdentity(startedSession) : null;
};
