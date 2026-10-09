import type { SessionStartWorkflowResult } from "@/features/session-start";
import type { AgentUserMessagePart } from "@openducktor/core";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

type AgentStudioSendTargetInput = {
  selectedSessionIdentity: AgentSessionIdentity | null;
  canStartNewSession: boolean;
};

export type StartSessionForMessage = (
  parts: AgentUserMessagePart[],
) => Promise<SessionStartWorkflowResult | undefined>;

export const canResolveAgentStudioSendTargetSession = ({
  selectedSessionIdentity,
  canStartNewSession,
}: AgentStudioSendTargetInput): boolean => selectedSessionIdentity !== null || canStartNewSession;
