import type { SessionStartWorkflowResult } from "@/features/session-start";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

type AgentStudioSendTargetInput = {
  selectedSessionIdentity: AgentSessionIdentity | null;
  canStartNewSession: boolean;
};

type ResolveAgentStudioSendTargetInput = AgentStudioSendTargetInput & {
  startSession: () => Promise<SessionStartWorkflowResult | undefined>;
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

  const startedSession = await startSession();
  return startedSession ? toAgentSessionIdentity(startedSession) : null;
};
