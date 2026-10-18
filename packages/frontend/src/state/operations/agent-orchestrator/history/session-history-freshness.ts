import {
  type AgentSessionCollection,
  listAgentSessions,
  replaceAgentSession,
} from "@/state/agent-session-collection";
import type { AgentSessionState } from "@/types/agent-orchestrator";

/** Keep the transcript baseline when live coverage ends. */
export const markSessionHistoryStale = (session: AgentSessionState): AgentSessionState => {
  if (session.historyLoadState === "loaded" || session.historyLoadState === "refreshing") {
    return { ...session, historyLoadState: "stale" };
  }
  return session.historyLoadState === "loading"
    ? { ...session, historyLoadState: "not_requested" }
    : session;
};

export const markSessionHistoriesStale = (
  collection: AgentSessionCollection,
): AgentSessionCollection => {
  let next = collection;
  for (const session of listAgentSessions(collection)) {
    next = replaceAgentSession(next, markSessionHistoryStale(session));
  }
  return next;
};
