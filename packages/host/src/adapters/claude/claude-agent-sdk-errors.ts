import type { SDKAssistantMessage, SDKRateLimitInfo } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "@openducktor/core";
import type { AgentSessionUsageLimit } from "@openducktor/contracts";
import { type ClaudeEventSession, userTurnIndex } from "./claude-agent-sdk-event-session";
import { readStringProp, textFromContentBlocks } from "./claude-agent-sdk-utils";
import { settleClaudeStreamedAssistantText } from "./claude-agent-sdk-transcript-retractions";

export type ErrorState = {
  usageReset?: { turnIndex: number; resetsAtEpochMs: number };
  lastError?: {
    turnIndex: number;
    messageId: string;
    message: string;
    usageLimit?: AgentSessionUsageLimit;
  };
};

/** Reuse the native error ID when its result arrives, so the transcript keeps one notice. */
export const handleAssistantError = ({
  message,
  session,
  emit,
  timestamp,
}: {
  message: SDKAssistantMessage;
  session: ClaudeEventSession;
  emit: (event: AgentEvent) => void;
  timestamp: string;
}): void => {
  const turnIndex = userTurnIndex(session);
  const reset = session.usageReset;
  session.lastError = {
    turnIndex,
    messageId: readStringProp(message.message, "id") ?? message.uuid,
    message: textFromContentBlocks(message.message.content) || `Claude API error: ${message.error}`,
  };
  if (message.error === "rate_limit") {
    session.lastError.usageLimit =
      reset?.turnIndex === turnIndex ? { resetsAtEpochMs: reset.resetsAtEpochMs } : {};
  }
  settleClaudeStreamedAssistantText({ emit, session, timestamp });
  emitError({ emit, session, timestamp });
};

/** A result can advance the queue before its failed turn receives reset data. */
export const updateRateLimit = ({
  info,
  session,
  emit,
  timestamp,
}: {
  info: SDKRateLimitInfo;
  session: ClaudeEventSession;
  emit: (event: AgentEvent) => void;
  timestamp: string;
}): void => {
  delete session.usageReset;
  if (info.status !== "rejected") return;
  const error = session.lastError;
  const turnIndex = error?.usageLimit ? error.turnIndex : userTurnIndex(session);
  // SDK reset times use Unix seconds.
  const resetsAtEpochMs = info.resetsAt === undefined ? undefined : info.resetsAt * 1000;
  if (resetsAtEpochMs !== undefined && Number.isFinite(resetsAtEpochMs) && resetsAtEpochMs >= 0) {
    session.usageReset = { turnIndex, resetsAtEpochMs };
  }
  if (error?.usageLimit) {
    error.usageLimit = session.usageReset
      ? { resetsAtEpochMs: session.usageReset.resetsAtEpochMs }
      : {};
    emitError({ session, emit, timestamp });
  }
};

const emitError = ({
  session,
  emit,
  timestamp,
}: {
  session: ClaudeEventSession;
  emit: (event: AgentEvent) => void;
  timestamp: string;
}): void => {
  const error = session.lastError;
  if (!error) return;
  const event: Extract<AgentEvent, { type: "turn_error" }> = {
    type: "turn_error",
    externalSessionId: session.externalSessionId,
    timestamp,
    messageId: error.messageId,
    message: error.message,
  };
  if (error.usageLimit) event.usageLimit = error.usageLimit;
  emit(event);
};
