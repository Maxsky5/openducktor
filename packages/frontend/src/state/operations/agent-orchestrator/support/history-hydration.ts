import type {
  AgentSessionHistoryHydrationState,
  AgentSessionState,
} from "@/types/agent-orchestrator";

export const DEFAULT_AGENT_SESSION_HISTORY_HYDRATION_STATE: AgentSessionHistoryHydrationState =
  "not_requested";

export const getAgentSessionHistoryHydrationState = (
  session: Pick<AgentSessionState, "historyHydrationState"> | null | undefined,
): AgentSessionHistoryHydrationState => {
  return session?.historyHydrationState ?? DEFAULT_AGENT_SESSION_HISTORY_HYDRATION_STATE;
};

export const shouldAutoHydrateAgentSessionHistory = (
  session: Pick<AgentSessionState, "historyHydrationState"> | null | undefined,
): boolean => {
  return getAgentSessionHistoryHydrationState(session) === "not_requested";
};

export const requiresHydratedAgentSessionHistory = (
  session: Pick<AgentSessionState, "historyHydrationState"> | null | undefined,
): boolean => {
  return getAgentSessionHistoryHydrationState(session) !== "hydrated";
};
