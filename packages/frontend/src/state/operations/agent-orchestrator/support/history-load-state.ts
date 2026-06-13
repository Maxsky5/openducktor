import type { AgentSessionHistoryLoadState, AgentSessionState } from "@/types/agent-orchestrator";

export const DEFAULT_AGENT_SESSION_HISTORY_LOAD_STATE: AgentSessionHistoryLoadState =
  "not_requested";

export const getAgentSessionHistoryLoadState = (
  session: Pick<AgentSessionState, "historyLoadState"> | null | undefined,
): AgentSessionHistoryLoadState => {
  return session?.historyLoadState ?? DEFAULT_AGENT_SESSION_HISTORY_LOAD_STATE;
};

export const requiresLoadedAgentSessionHistory = (
  session: Pick<AgentSessionState, "historyLoadState"> | null | undefined,
): boolean => {
  return getAgentSessionHistoryLoadState(session) !== "loaded";
};
