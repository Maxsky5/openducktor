import type { AgentSessionState } from "@/types/agent-orchestrator";

export type SessionStateHarness<TSession extends AgentSessionState = AgentSessionState> = {
  sessionsRef: { current: Record<string, TSession> };
  setSessionsById: (
    updater:
      | Record<string, TSession>
      | ((current: Record<string, TSession>) => Record<string, TSession>),
  ) => void;
  updateSession: (externalSessionId: string, updater: (current: TSession) => TSession) => void;
  getState: () => Record<string, TSession>;
};

export const createStateHarness = <TSession extends AgentSessionState = AgentSessionState>(
  sessions: Record<string, NoInfer<TSession>> = {},
): SessionStateHarness<TSession> => {
  let state = sessions;
  const sessionsRef = { current: state };
  return {
    sessionsRef,
    setSessionsById: (updater) => {
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    },
    updateSession: (externalSessionId, updater) => {
      const current = state[externalSessionId];
      if (!current) {
        return;
      }
      state = {
        ...state,
        [externalSessionId]: updater(current),
      };
      sessionsRef.current = state;
    },
    getState: () => state,
  };
};
