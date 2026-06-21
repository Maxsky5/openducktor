import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { createSessionTurnMetadata, type SessionTurnMetadata } from "./session-turn-metadata";
import { createSessionTurnTiming, type SessionTurnTiming } from "./session-turn-timing";

export type SessionTurnState = {
  timing: SessionTurnTiming;
  metadata: SessionTurnMetadata;
  clearSession: (session: AgentSessionIdentity) => void;
  clearAll: () => void;
};

export const createSessionTurnState = (): SessionTurnState => {
  const timing = createSessionTurnTiming();
  const metadata = createSessionTurnMetadata();

  return {
    timing,
    metadata,
    clearSession: (session) => {
      const sessionKey = agentSessionIdentityKey(session);
      timing.clearSession(sessionKey);
      metadata.clearSession(sessionKey);
    },
    clearAll: () => {
      timing.clearAll();
      metadata.clearAll();
    },
  };
};
