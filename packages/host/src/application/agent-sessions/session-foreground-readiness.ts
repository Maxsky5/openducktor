import type { AgentSessionLiveSnapshot } from "@openducktor/contracts";
import { goalDrivesWork, isAgentSessionBlockedOnInput } from "@openducktor/core";

export const isReadyForTurn = (session: AgentSessionLiveSnapshot): boolean =>
  !session.statusUnavailableReason &&
  (session.foregroundTurnActive === undefined
    ? session.activity === "idle"
    : !session.foregroundTurnActive) &&
  !hasBlockingInput(session);

export const hasForegroundTurn = (session: AgentSessionLiveSnapshot): boolean =>
  session.foregroundTurnActive ??
  (session.activity === "running" || session.activity === "retrying");

/** An active goal drives the work, so the runtime starts each next turn by itself. */
export const isGoalDrivingWork = (session: AgentSessionLiveSnapshot): boolean =>
  goalDrivesWork(session.goal, session.activity !== "idle");

export const hasBlockingInput = (session: AgentSessionLiveSnapshot): boolean =>
  session.activity === "waiting_for_permission" ||
  session.activity === "waiting_for_question" ||
  isAgentSessionBlockedOnInput(session);
