import type { AgentSessionHistoryMessage } from "@openducktor/core";
import { interruptedTurnResumeError } from "@openducktor/core";
import { hasActiveClaudeWork } from "./claude-agent-sdk-session-store";
import type { ClaudeSession } from "./claude-agent-sdk-types";

/**
 * Rejects a continuation that the live session cannot start: waiting input, live work,
 * or a completed latest turn. The final-assistant check matches the turn index, so a
 * final text from an earlier turn does not hide an unfinished latest turn.
 *
 * A session that has not accepted a user turn in this process cannot answer the
 * latest-turn question. The caller must consult the persisted transcript when
 * {@link claudeLiveContinuationNeedsTranscript} is true.
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
  const latestAcceptedTurnIndex = session.acceptedUserMessages.length;
  if (
    latestAcceptedTurnIndex > 0 &&
    session.lastAssistantTextFinal === true &&
    session.lastAssistantTextTurnIndex === latestAcceptedTurnIndex
  ) {
    throw interruptedTurnResumeError({
      reason: "completed_turn",
      message: `Claude session '${externalSessionId}' has a final assistant result.`,
    });
  }
};

/**
 * Reports whether the live session lacks the state that proves an unfinished latest turn.
 * A fresh or normally resumed session starts with no accepted user turns, so only the
 * persisted transcript can distinguish no-user, completed, and unfinished turns.
 */
export const claudeLiveContinuationNeedsTranscript = (session: ClaudeSession): boolean =>
  session.acceptedUserMessages.length === 0;

const hasFinalAssistantHistory = (message: AgentSessionHistoryMessage): boolean =>
  message.role === "assistant" &&
  message.parts.some(
    (part) => part.kind === "step" && part.phase === "finish" && part.reason === "stop",
  );

/**
 * Rejects a continuation that the persisted transcript cannot start. The host uses it
 * after a restart, when no live session entry exists yet.
 */
export const assertClaudePersistedContinuationEligible = (
  history: readonly AgentSessionHistoryMessage[],
  externalSessionId: string,
): void => {
  const latestUserIndex = history.findLastIndex((message) => message.role === "user");
  if (latestUserIndex < 0) {
    throw interruptedTurnResumeError({
      reason: "ineligible_turn_state",
      message: `Claude session '${externalSessionId}' has no unfinished user turn to continue.`,
    });
  }
  if (history.slice(latestUserIndex + 1).some(hasFinalAssistantHistory)) {
    throw interruptedTurnResumeError({
      reason: "completed_turn",
      message: `Claude session '${externalSessionId}' has a final assistant result.`,
    });
  }
};
