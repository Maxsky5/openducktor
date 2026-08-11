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
  canClaimLoad(session: SessionHistoryLoadPolicySession): boolean;
  propagateFailure: boolean;
  abandonLoad(session: AgentSessionState): AgentSessionState;
  failLoad(session: AgentSessionState, failure: SessionHistoryFailure): AgentSessionState;
  applyLoadedHistory(
    session: AgentSessionState,
    history: AgentSessionHistoryMessage[],
  ): AgentSessionState;
};

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
  canClaimLoad: (session) =>
    !hasLoadedSessionHistory(session) || session.historyLoadFailure != null,
  propagateFailure: false,
  abandonLoad: abandonBaselineLoad,
  failLoad: failBaselineLoad,
  applyLoadedHistory: applyLoadedSessionHistory,
};

export const selectedSessionBaselineHistoryLoadPolicy: SessionHistoryLoadPolicy = {
  canClaimLoad: shouldRequestSelectedSessionBaselineHistory,
  propagateFailure: false,
  abandonLoad: abandonBaselineLoad,
  failLoad: failBaselineLoad,
  applyLoadedHistory: applyLoadedSessionHistory,
};

export const transcriptGapRecoveryHistoryLoadPolicy: SessionHistoryLoadPolicy = {
  canClaimLoad: hasLoadedSessionHistory,
  propagateFailure: true,
  abandonLoad: restoreLoadedHistoryState,
  failLoad: markLoadedHistoryFailed,
  applyLoadedHistory: applyLoadedSessionHistory,
};
