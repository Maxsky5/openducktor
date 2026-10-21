import type { AgentSessionHistoryMessage } from "@openducktor/core";
import {
  addClaudeHistoryFinishStep,
  clearClaudeHistoryAssistantFinality,
  isLiveFinalAssistantStopReason,
  type MutableAssistantHistoryMessage,
} from "./claude-agent-sdk-history-assistant";
import { hasFinalStopStep, type ClaudeLiveUserMessage } from "./claude-agent-sdk-history-support";
import type { ClaudeHistoryToolResultState } from "./claude-agent-sdk-history-tool-results";
import { shouldFinalizeClaudeTurn } from "./claude-agent-sdk-user-messages";

export const readClaudeHistoryAssistantTracking = (
  history: readonly AgentSessionHistoryMessage[],
) => {
  let lastAssistantMessage: MutableAssistantHistoryMessage | null = null;
  let lastAssistantTextMessage: MutableAssistantHistoryMessage | null = null;
  let lastAssistantText: string | undefined;
  let lastFinalAssistantMessage: MutableAssistantHistoryMessage | null = null;
  let lastFinalAssistantText: string | undefined;
  for (const message of history) {
    if (message.role !== "assistant") continue;
    lastAssistantMessage = message;
    const messageText = message.text.trim();
    if (messageText.length === 0) continue;
    lastAssistantTextMessage = message;
    lastAssistantText = messageText;
    if (hasFinalStopStep(message)) {
      lastFinalAssistantMessage = message;
      lastFinalAssistantText = messageText;
    }
  }
  return {
    lastAssistantMessage,
    lastAssistantTextMessage,
    lastAssistantText,
    lastFinalAssistantMessage,
    lastFinalAssistantText,
  };
};

export const createClaudeHistoryFinality = (
  background: Pick<
    ClaudeHistoryToolResultState,
    "activeBackgroundSubagentTaskIds" | "backgroundToolActiveTaskIds"
  >,
) => {
  let autonomousFinal: MutableAssistantHistoryMessage | null = null;
  let pending: {
    message: MutableAssistantHistoryMessage;
    model: MutableAssistantHistoryMessage["model"];
  } | null = null;

  const finishPreviousUserTurn = () => {
    if (!pending) return;
    addClaudeHistoryFinishStep(pending.message, "stop");
    if (pending.model) pending.message.model = pending.model;
    pending = null;
  };

  return {
    clearPending: () => {
      pending = null;
    },
    retract: (messageIds: ReadonlySet<string>) => {
      if (pending && messageIds.has(pending.message.messageId)) pending = null;
      if (autonomousFinal && messageIds.has(autonomousFinal.messageId)) autonomousFinal = null;
    },
    observeUser: (originKind: string | undefined) => {
      if (originKind === undefined) return;
      if (originKind !== "human") {
        pending = null;
        if (autonomousFinal) {
          clearClaudeHistoryAssistantFinality(autonomousFinal);
        }
      }
      autonomousFinal = null;
    },
    rememberFinal: (message: MutableAssistantHistoryMessage, originKind: string | undefined) => {
      if (originKind && originKind !== "human") autonomousFinal = message;
    },
    captureAssistant: (
      message: MutableAssistantHistoryMessage,
      model: MutableAssistantHistoryMessage["model"],
      stopReason: string | undefined,
      originKind: string | undefined,
      shouldFinalize: boolean,
    ) => {
      pending = null;
      if (
        !shouldFinalize &&
        message.text.trim().length > 0 &&
        isLiveFinalAssistantStopReason(stopReason) &&
        shouldFinalizeClaudeTurn(originKind, 0) &&
        background.activeBackgroundSubagentTaskIds.size === 0 &&
        (background.backgroundToolActiveTaskIds?.size ?? 0) > 0
      ) {
        pending = { message, model };
      }
    },
    finishPreviousUserTurn,
    startHumanTurn: () => {
      finishPreviousUserTurn();
      autonomousFinal = null;
    },
    finishBeforeLiveUser: (
      history: readonly AgentSessionHistoryMessage[],
      liveUserMessages: readonly ClaudeLiveUserMessage[],
    ) => {
      if (!pending) return;
      const terminalAtMs = Date.parse(pending.message.timestamp);
      const hasNewerUnmatchedUser = liveUserMessages.some(
        (message) =>
          !message.isManualCompaction &&
          Date.parse(message.timestamp) > terminalAtMs &&
          !history.some((projected) => projected.messageId === message.messageId),
      );
      if (hasNewerUnmatchedUser) finishPreviousUserTurn();
    },
  };
};
