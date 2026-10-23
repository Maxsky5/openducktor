import type { AgentSessionLiveSnapshot } from "@openducktor/contracts";
import { isAgentSessionBlockedOnInput } from "@openducktor/core";

export const hasActiveForegroundTurn = (session: AgentSessionLiveSnapshot): boolean =>
  session.foregroundTurnActive ??
  (session.activity === "running" || session.activity === "retrying");

export const hasBlockingSessionInput = (session: AgentSessionLiveSnapshot): boolean =>
  session.activity === "waiting_for_permission" ||
  session.activity === "waiting_for_question" ||
  isAgentSessionBlockedOnInput(session);

export const isSessionReadyForTurn = (session: AgentSessionLiveSnapshot): boolean =>
  !session.statusUnavailableReason &&
  (session.foregroundTurnActive === undefined
    ? session.activity === "idle"
    : !session.foregroundTurnActive) &&
  !hasBlockingSessionInput(session);
