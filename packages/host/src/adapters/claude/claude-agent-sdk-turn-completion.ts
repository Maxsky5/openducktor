import { isClaudeForegroundTurnActive } from "./claude-agent-sdk-activity";
import type { ClaudeEventSession } from "./claude-agent-sdk-event-session";
import type { ClaudeSdkResultMessageProjection } from "./claude-agent-sdk-message-projection";

export type ClaudeTurnCompletionSession = Parameters<typeof isClaudeForegroundTurnActive>[0] &
  Pick<
    ClaudeEventSession,
    | "sdkInitiatedTurnActive"
    | "lastAssistantNativeUuid"
    | "lastAssistantNativeUuidTurnIndex"
    | "lastAssistantTextMessageId"
    | "lastAssistantText"
    | "lastAssistantTextFinal"
    | "lastAssistantTextModel"
    | "lastAssistantTextDurationMs"
    | "lastAssistantTextTurnIndex"
    | "lastSuccessfulResultTurnIndex"
  >;

export const clearClaudePreviousAssistantTracking = (
  session: Pick<
    ClaudeEventSession,
    | "lastAssistantNativeUuid"
    | "lastAssistantNativeUuidTurnIndex"
    | "lastAssistantTextMessageId"
    | "lastAssistantText"
    | "lastAssistantTextFinal"
    | "lastAssistantTextModel"
    | "lastAssistantTextDurationMs"
    | "lastAssistantTextTurnIndex"
  >,
): void => {
  delete session.lastAssistantNativeUuid;
  delete session.lastAssistantNativeUuidTurnIndex;
  delete session.lastAssistantTextMessageId;
  delete session.lastAssistantText;
  delete session.lastAssistantTextFinal;
  delete session.lastAssistantTextModel;
  delete session.lastAssistantTextDurationMs;
  delete session.lastAssistantTextTurnIndex;
};

export const clearClaudeTurnCompletionForFailedTurn = (
  session: Pick<
    ClaudeEventSession,
    | "lastSuccessfulResultTurnIndex"
    | "lastAssistantTextTurnIndex"
    | "lastAssistantTextFinal"
    | "lastAssistantNativeUuid"
    | "lastAssistantNativeUuidTurnIndex"
  >,
  completedUserTurnIndex: number,
): void => {
  if (session.lastSuccessfulResultTurnIndex === completedUserTurnIndex) {
    delete session.lastSuccessfulResultTurnIndex;
  }
  if (session.lastAssistantTextTurnIndex === completedUserTurnIndex) {
    delete session.lastAssistantTextFinal;
  }
  if (session.lastAssistantNativeUuidTurnIndex === completedUserTurnIndex) {
    delete session.lastAssistantNativeUuid;
    delete session.lastAssistantNativeUuidTurnIndex;
  }
};

export type ClaudeCompletedResultCheck = {
  readonly completedOwnTurn: boolean;
  readonly hasCurrentFinalText: boolean;
  readonly hasCurrentLocalCommandOutput: boolean;
};

export const evaluateClaudeCompletedResult = (
  session: ClaudeTurnCompletionSession,
  message: ClaudeSdkResultMessageProjection,
  completedUserTurnIndex: number,
  resultText: string,
): ClaudeCompletedResultCheck => {
  const hasCurrentFinalText =
    session.lastAssistantTextFinal === true &&
    session.lastAssistantTextTurnIndex === completedUserTurnIndex;
  const hasCurrentLocalCommandOutput =
    message.subtype === "success" &&
    Boolean(message.local_command) &&
    Boolean(session.lastAssistantText) &&
    session.lastAssistantTextTurnIndex === completedUserTurnIndex;
  const hasCurrentAssistant =
    Boolean(session.lastAssistantNativeUuid) &&
    session.lastAssistantNativeUuidTurnIndex === completedUserTurnIndex;
  const hasResultTurnEvidence =
    message.num_turns > 0 ||
    (message.subtype === "success" &&
      (message.stop_reason !== null || Boolean(message.local_command)));
  // An empty non-query or notification-only result does no model work and must not mark an
  // interrupted turn complete.
  const completedOwnTurn =
    resultText.length > 0 ||
    hasCurrentFinalText ||
    hasCurrentAssistant ||
    (isClaudeForegroundTurnActive(session) &&
      !session.sdkInitiatedTurnActive &&
      hasResultTurnEvidence);
  return { completedOwnTurn, hasCurrentFinalText, hasCurrentLocalCommandOutput };
};
