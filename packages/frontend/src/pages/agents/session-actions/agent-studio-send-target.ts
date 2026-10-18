import type { SessionStartWorkflowResult } from "@/features/session-start";
import type { AgentUserMessagePart } from "@openducktor/core";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";

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
