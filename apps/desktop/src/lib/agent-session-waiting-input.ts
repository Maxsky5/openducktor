import type { AgentSessionState } from "@/types/agent-orchestrator";

export const isAgentSessionWaitingInput = (
  session: Pick<AgentSessionState, "pendingPermissions" | "pendingQuestions">,
): boolean => session.pendingPermissions.length > 0 || session.pendingQuestions.length > 0;
