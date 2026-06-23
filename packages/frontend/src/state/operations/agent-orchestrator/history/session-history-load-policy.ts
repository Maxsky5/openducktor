import type { AgentSessionHistoryMessage } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { applyLoadedSessionHistory } from "../support/session-history-chat-messages";
import {
  hasLoadedSessionHistory,
  hasRenderableSessionTranscript,
} from "../transcript/session-transcript-content";

type SessionHistoryLoadPolicySession = Pick<
  AgentSessionState,
  "externalSessionId" | "messages" | "historyLoadState"
>;

export type SessionHistoryLoadPolicy = {
  canClaimLoad(session: SessionHistoryLoadPolicySession): boolean;
  applyLoadedHistory(
    session: AgentSessionState,
    history: AgentSessionHistoryMessage[],
  ): AgentSessionState;
};

export const shouldRequestSelectedSessionBaselineHistory = (
  session: SessionHistoryLoadPolicySession,
): boolean =>
  session.historyLoadState === "not_requested" && !hasRenderableSessionTranscript(session);

const resetSelectedSessionBaselineClaim = (session: AgentSessionState): AgentSessionState =>
  session.historyLoadState === "loading"
    ? {
        ...session,
        historyLoadState: "not_requested",
      }
    : session;

export const requestedSessionHistoryLoadPolicy: SessionHistoryLoadPolicy = {
  canClaimLoad: (session) => !hasLoadedSessionHistory(session),
  applyLoadedHistory: applyLoadedSessionHistory,
};

export const selectedSessionBaselineHistoryLoadPolicy: SessionHistoryLoadPolicy = {
  canClaimLoad: shouldRequestSelectedSessionBaselineHistory,
  applyLoadedHistory: (session, history) => {
    if (hasRenderableSessionTranscript(session)) {
      return resetSelectedSessionBaselineClaim(session);
    }

    return applyLoadedSessionHistory(session, history);
  },
};
