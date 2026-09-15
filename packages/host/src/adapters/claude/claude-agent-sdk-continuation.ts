import { interruptedTurnResumeError } from "@openducktor/core";
import { hasActiveClaudeWork } from "./claude-agent-sdk-session-store";
import type { ClaudeSession } from "./claude-agent-sdk-types";

/**
 * Rejects a continuation that the live session cannot start: waiting input, live work,
 * or a final assistant result. The caller closes the session before it starts a new turn.
 */
export const assertClaudeContinuationEligible = (
  session: ClaudeSession,
  externalSessionId: string,
): void => {
  if (session.pendingApprovals.size > 0 || session.pendingQuestions.size > 0) {
    throw interruptedTurnResumeError({
      reason: "waiting_input",
      message: `Claude session '${externalSessionId}' is waiting for a pending approval or question.`,
    });
  }
  if (hasActiveClaudeWork(session)) {
    throw interruptedTurnResumeError({
      reason: "live_turn",
      message: `Claude session '${externalSessionId}' has live work.`,
    });
  }
  if (session.lastAssistantTextFinal === true) {
    throw interruptedTurnResumeError({
      reason: "completed_turn",
      message: `Claude session '${externalSessionId}' has a final assistant result.`,
    });
  }
};
