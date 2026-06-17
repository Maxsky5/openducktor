import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { SessionObservers } from "./session-observers";

export const cleanupLocalAgentSessions = ({
  sessions,
  sessionObservers,
  clearSessionTurnState,
}: {
  sessions: readonly AgentSessionIdentity[];
  sessionObservers: SessionObservers;
  clearSessionTurnState: (session: AgentSessionIdentity) => void;
}): void => {
  if (sessions.length === 0) {
    return;
  }

  sessionObservers.removeMany(sessions);
  for (const session of sessions) {
    clearSessionTurnState(session);
  }
};
