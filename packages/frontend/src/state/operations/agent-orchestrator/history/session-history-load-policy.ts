import type { SessionHistoryFailure } from "@openducktor/contracts";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { applyLoadedSessionHistory } from "../support/session-history-chat-messages";
import { hasLoadedSessionHistory } from "../transcript/session-transcript-content";

type SessionHistoryLoadPolicySession = Pick<
  AgentSessionState,
  "externalSessionId" | "messages" | "historyLoadState" | "historyLoadFailure"
>;

export type SessionHistoryLoadPolicy = {
  claimLoad(session: AgentSessionState): AgentSessionState | null;
  propagateFailure: boolean;
  abandonLoad(session: AgentSessionState): AgentSessionState;
  failLoad(session: AgentSessionState, failure: SessionHistoryFailure): AgentSessionState;
  applyLoadedHistory(
    session: AgentSessionState,
    history: AgentSessionHistoryMessage[],
    messagesAtReadStart?: AgentSessionState["messages"],
  ): AgentSessionState;
};

const markSessionHistoryLoading = (session: AgentSessionState): AgentSessionState => ({
  ...session,
  historyLoadState: "loading",
  historyLoadFailure: null,
});

const abandonBaselineLoad = (session: AgentSessionState): AgentSessionState =>
  session.historyLoadState === "loading"
    ? { ...session, historyLoadState: "not_requested", historyLoadFailure: null }
    : session;

const failBaselineLoad = (
  session: AgentSessionState,
  failure: SessionHistoryFailure,
): AgentSessionState =>
  session.historyLoadState === "loaded"
    ? session
    : { ...session, historyLoadState: "failed", historyLoadFailure: failure };

const restoreLoadedHistoryState = (session: AgentSessionState): AgentSessionState => ({
  ...session,
  historyLoadState: "loaded",
  historyLoadFailure: null,
});

const markLoadedHistoryFailed = (
  session: AgentSessionState,
  failure: SessionHistoryFailure,
): AgentSessionState => ({
  ...session,
  historyLoadState: "loaded",
  historyLoadFailure: failure,
});

export const shouldRequestSelectedSessionBaselineHistory = (
  session: SessionHistoryLoadPolicySession,
): boolean => session.historyLoadState === "not_requested";

export const requestedSessionHistoryLoadPolicy: SessionHistoryLoadPolicy = {
  claimLoad: (session) => {
    if (session.historyLoadState === "loading") {
      return null;
    }
    if (hasLoadedSessionHistory(session) && session.historyLoadFailure == null) {
      return null;
    }
    return markSessionHistoryLoading(session);
  },
  propagateFailure: false,
  abandonLoad: abandonBaselineLoad,
  failLoad: failBaselineLoad,
  applyLoadedHistory: applyLoadedSessionHistory,
};

export const selectedSessionBaselineHistoryLoadPolicy: SessionHistoryLoadPolicy = {
  claimLoad: (session) =>
    shouldRequestSelectedSessionBaselineHistory(session)
      ? markSessionHistoryLoading(session)
      : null,
  propagateFailure: false,
  abandonLoad: abandonBaselineLoad,
  failLoad: failBaselineLoad,
  applyLoadedHistory: applyLoadedSessionHistory,
};

export const transcriptGapRecoveryHistoryLoadPolicy: SessionHistoryLoadPolicy = {
  claimLoad: (session) =>
    hasLoadedSessionHistory(session) ? markSessionHistoryLoading(session) : null,
  propagateFailure: true,
  abandonLoad: restoreLoadedHistoryState,
  failLoad: markLoadedHistoryFailed,
  applyLoadedHistory: applyLoadedSessionHistory,
};

export const retainedSessionRevalidationHistoryLoadPolicy: SessionHistoryLoadPolicy = {
  claimLoad: (session) =>
    hasLoadedSessionHistory(session) ? { ...session, historyLoadFailure: null } : null,
  propagateFailure: false,
  abandonLoad: (session) => session,
  failLoad: markLoadedHistoryFailed,
  applyLoadedHistory: applyLoadedSessionHistory,
};
