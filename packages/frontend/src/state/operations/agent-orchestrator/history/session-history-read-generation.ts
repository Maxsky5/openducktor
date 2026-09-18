import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

export type SessionHistoryReadGeneration = {
  begin(identity: AgentSessionIdentity): number;
  isLatest(identity: AgentSessionIdentity, readToken: number): boolean;
  finish(identity: AgentSessionIdentity, readToken: number): void;
};

export const createSessionHistoryReadGeneration = (): SessionHistoryReadGeneration => {
  const latestReadTokenBySessionKey = new Map<string, number>();
  let nextReadToken = 0;

  return {
    begin: (identity) => {
      nextReadToken += 1;
      latestReadTokenBySessionKey.set(agentSessionIdentityKey(identity), nextReadToken);
      return nextReadToken;
    },
    isLatest: (identity, readToken) =>
      latestReadTokenBySessionKey.get(agentSessionIdentityKey(identity)) === readToken,
    finish: (identity, readToken) => {
      const sessionKey = agentSessionIdentityKey(identity);
      if (latestReadTokenBySessionKey.get(sessionKey) === readToken) {
        latestReadTokenBySessionKey.delete(sessionKey);
      }
    },
  };
};
