import type { ClaudeSession } from "./claude-agent-sdk-types";

/**
 * A new user turn can start only while no turn runs or waits to start. The CLI can merge user
 * messages that arrive close together into one turn, which would break the turn counts.
 */
export const canStartUserTurn = (session: ClaudeSession): boolean =>
  session.activeSdkUserTurnCount === 0 &&
  session.pendingUserTurnCount === 0 &&
  session.sdkState !== "running" &&
  session.sdkState !== "requires_action";
