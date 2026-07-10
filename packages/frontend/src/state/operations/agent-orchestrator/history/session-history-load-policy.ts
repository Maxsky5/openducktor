import type { AgentSessionHistoryMessage } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { applyLoadedSessionHistory } from "../support/session-history-chat-messages";
import { hasLoadedSessionHistory } from "../transcript/session-transcript-content";

type SessionHistoryLoadPolicySession = Pick<
  AgentSessionState,
  "externalSessionId" | "messages" | "historyLoadState"
>;

type SelectedSessionContextUsageSession = Pick<
  AgentSessionState,
  "contextUsage" | "historyLoadState" | "status"
>;

export type SessionHistoryLoadPolicy = {
  canClaimLoad(session: SessionHistoryLoadPolicySession): boolean;
  propagateFailure: boolean;
  abandonLoad(session: AgentSessionState): AgentSessionState;
  failLoad(session: AgentSessionState): AgentSessionState;
  applyLoadedHistory(
    session: AgentSessionState,
    history: AgentSessionHistoryMessage[],
  ): AgentSessionState;
};

const abandonBaselineLoad = (session: AgentSessionState): AgentSessionState =>
  session.historyLoadState === "loading"
    ? { ...session, historyLoadState: "not_requested" }
    : session;

const failBaselineLoad = (session: AgentSessionState): AgentSessionState =>
  session.historyLoadState === "loaded" ? session : { ...session, historyLoadState: "failed" };

const restoreLoadedHistoryState = (session: AgentSessionState): AgentSessionState => ({
  ...session,
  historyLoadState: "loaded",
});

export const shouldRequestSelectedSessionBaselineHistory = (
  session: SessionHistoryLoadPolicySession,
): boolean => session.historyLoadState === "not_requested";

export const shouldRequestSelectedSessionContextUsage = (
  session: SelectedSessionContextUsageSession,
): boolean =>
  session.status === "idle" &&
  session.historyLoadState === "loaded" &&
  session.contextUsage == null;

export const requestedSessionHistoryLoadPolicy: SessionHistoryLoadPolicy = {
  canClaimLoad: (session) => !hasLoadedSessionHistory(session),
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
  failLoad: restoreLoadedHistoryState,
  applyLoadedHistory: applyLoadedSessionHistory,
};
