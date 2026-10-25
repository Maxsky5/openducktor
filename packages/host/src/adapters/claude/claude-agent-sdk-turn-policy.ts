import type { ClaudeSession } from "./claude-agent-sdk-types";
import { hasClaudeBlockingInput, isClaudeForegroundTurnActive } from "./claude-agent-sdk-activity";
import { isClaudeSessionClosing } from "./claude-agent-sdk-session-lifecycle";

/**
 * A new user turn can start only while no turn runs or waits to start. The CLI can merge user
 * messages that arrive close together into one turn, which would break the turn counts.
 */
export const canStartUserTurn = (session: ClaudeSession): boolean =>
  session.activity !== "stopped" &&
  !isClaudeSessionClosing(session) &&
  session.statusUnavailableReason === undefined &&
  !isClaudeForegroundTurnActive(session) &&
  !hasClaudeBlockingInput(session) &&
  session.sdkState !== "requires_action" &&
  (session.foregroundTurnActive === false || session.sdkState !== "running");
