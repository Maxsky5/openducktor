import type { SessionHistoryFailure } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { hasLoadedSessionHistory } from "../transcript/session-transcript-content";

export const claimSessionHistoryLoad = (session: AgentSessionState): AgentSessionState | null => {
  if (
    session.historyLoadState === "loading" ||
    session.historyLoadState === "refreshing" ||
    (session.historyLoadState === "loaded" && session.historyLoadFailure == null)
  ) {
    return null;
  }
  return {
    ...session,
    historyLoadState: hasLoadedSessionHistory(session) ? "refreshing" : "loading",
    historyLoadFailure: null,
  };
};

export const abandonSessionHistoryLoad = (session: AgentSessionState): AgentSessionState => {
  if (session.historyLoadState === "refreshing") {
    return { ...session, historyLoadState: "stale" };
  }
  return session.historyLoadState === "loading"
    ? { ...session, historyLoadState: "not_requested" }
    : session;
};

export const failSessionHistoryLoad = (
  session: AgentSessionState,
  failure: SessionHistoryFailure,
): AgentSessionState => ({
  ...session,
  historyLoadState: hasLoadedSessionHistory(session) ? "stale" : "failed",
  historyLoadFailure: failure,
});
