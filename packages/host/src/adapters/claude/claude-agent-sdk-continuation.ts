import type { AgentSessionHistoryMessage } from "@openducktor/core";
import {
  interruptedTurnResumeError,
  type InterruptedTurnResumeError,
  type InterruptedTurnResumeFailureReason,
} from "@openducktor/core";
import { hasActiveClaudeBackgroundTools } from "./claude-agent-sdk-event-session";
import { hasActiveClaudeWork } from "./claude-agent-sdk-session-store";
import type { ClaudeSession } from "./claude-agent-sdk-types";

/**
 * The outcome of one continuation gate. `needs_transcript` means the live state cannot
 * answer the latest-turn question, so the caller must decide from the persisted
 * transcript.
 */
export type ClaudeContinuationDecision =
  | { readonly kind: "allow" }
  | { readonly kind: "needs_transcript" }
  | { readonly kind: "reject"; readonly error: InterruptedTurnResumeError };

const reject = (
  reason: InterruptedTurnResumeFailureReason,
  message: string,
): ClaudeContinuationDecision => ({
  kind: "reject",
  error: interruptedTurnResumeError({ reason, message }),
});

/**
 * Decides whether the live session can start a continuation. The live state answers
 * waiting input, live work, and an in-process completed latest turn. The final-assistant
 * check matches the turn index, so a final text from an earlier turn does not hide an
 * unfinished latest turn.
 *
 * A session that has not accepted a user turn in this process cannot answer the
 * latest-turn question, so the decision asks for the persisted transcript.
 */
export const decideClaudeLiveContinuation = (
  session: ClaudeSession,
  externalSessionId: string,
): ClaudeContinuationDecision => {
  if (session.pendingApprovals.size > 0 || session.pendingQuestions.size > 0) {
    return reject(
      "waiting_input",
      `Claude session '${externalSessionId}' is waiting for a pending approval or question.`,
    );
  }
  if (hasActiveClaudeWork(session) || hasActiveClaudeBackgroundTools(session)) {
    return reject("live_turn", `Claude session '${externalSessionId}' has live work.`);
  }
  const latestAcceptedTurnIndex = session.acceptedUserMessages.length;
  if (latestAcceptedTurnIndex === 0) {
    return { kind: "needs_transcript" };
  }
  if (
    session.lastSuccessfulResultTurnIndex === latestAcceptedTurnIndex ||
    (session.lastAssistantTextFinal === true &&
      session.lastAssistantTextTurnIndex === latestAcceptedTurnIndex)
  ) {
    return reject(
      "completed_turn",
      `Claude session '${externalSessionId}' has a completed latest turn.`,
    );
  }
  return { kind: "allow" };
};

const hasFinalAssistantHistory = (message: AgentSessionHistoryMessage): boolean =>
  message.role === "assistant" &&
  message.parts.some(
    (part) => part.kind === "step" && part.phase === "finish" && part.reason === "stop",
  );

/**
 * Decides whether the persisted transcript can start a continuation. The transcript is
 * the only source that separates no-user, completed, and unfinished turns after a
 * restart, and for a session that has not accepted a user turn in this process.
 */
export const decideClaudePersistedContinuation = (
  history: readonly AgentSessionHistoryMessage[],
  externalSessionId: string,
): ClaudeContinuationDecision => {
  const latestUserIndex = history.findLastIndex((message) => message.role === "user");
  if (latestUserIndex < 0) {
    return reject(
      "ineligible_turn_state",
      `Claude session '${externalSessionId}' has no unfinished user turn to continue.`,
    );
  }
  if (history.slice(latestUserIndex + 1).some(hasFinalAssistantHistory)) {
    return reject(
      "completed_turn",
      `Claude session '${externalSessionId}' has a final assistant result.`,
    );
  }
  return { kind: "allow" };
};

/**
 * Decides a continuation from the live session, then from the persisted transcript when
 * the live state cannot answer the latest-turn question. `readTranscript` reads the
 * persisted history for the session and runs only for that second step.
 */
export const decideClaudeContinuation = async (
  session: ClaudeSession,
  externalSessionId: string,
  readTranscript: () => Promise<readonly AgentSessionHistoryMessage[]>,
): Promise<ClaudeContinuationDecision> => {
  const liveDecision = decideClaudeLiveContinuation(session, externalSessionId);
  if (liveDecision.kind !== "needs_transcript") {
    return liveDecision;
  }
  return decideClaudePersistedContinuation(await readTranscript(), externalSessionId);
};
