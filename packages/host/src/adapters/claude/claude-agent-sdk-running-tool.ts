import type { ClaudeEventSession } from "./claude-agent-sdk-event-session";
import type { ClaudeSdkToolProgressMessageProjection } from "./claude-agent-sdk-message-projection";
import {
  type ClaudeDecodedToolUse,
  createClaudeRunningToolPart,
  timestampMs,
} from "./claude-agent-sdk-tool-shapes";
import type { ClaudeAgentSdkEvent } from "./claude-agent-sdk-types";

export const handleClaudeToolProgressMessage = ({
  emit,
  message,
  session,
  timestamp,
}: {
  emit: (event: ClaudeAgentSdkEvent) => void;
  message: ClaudeSdkToolProgressMessageProjection;
  session: ClaudeEventSession;
  timestamp: string;
}): void => {
  const elapsedMs = Math.max(0, Math.round(message.elapsed_time_seconds * 1000));
  const startedAtMs = timestampMs(timestamp) - elapsedMs;

  emitClaudeRunningToolPart({
    emit,
    fallbackMessageId: message.uuid,
    session,
    startedAtMs,
    timestamp,
    toolUse: {
      blockType: "tool_progress",
      callId: message.tool_use_id,
      toolName: message.tool_name,
      metadata: {
        elapsedTimeSeconds: message.elapsed_time_seconds,
        durationMs: elapsedMs,
      },
    },
  });
};

export const emitClaudeRunningToolPart = ({
  emit,
  fallbackMessageId,
  session,
  startedAtMs,
  timestamp,
  toolUse,
}: {
  emit: (event: ClaudeAgentSdkEvent) => void;
  fallbackMessageId: string;
  session: ClaudeEventSession;
  startedAtMs: number;
  timestamp: string;
  toolUse: ClaudeDecodedToolUse;
}): void => {
  const messageId = session.toolMessageIdsByCallId.get(toolUse.callId) ?? fallbackMessageId;
  session.toolMessageIdsByCallId.set(toolUse.callId, messageId);
  session.toolNamesByCallId.set(toolUse.callId, toolUse.toolName);
  session.toolStartedAtMsByCallId.set(toolUse.callId, startedAtMs);
  if (toolUse.input) {
    session.toolInputsByCallId.set(toolUse.callId, toolUse.input);
  }
  const cachedInput = session.toolInputsByCallId.get(toolUse.callId);
  const effectiveToolUse =
    !toolUse.input && cachedInput
      ? {
          ...toolUse,
          input: cachedInput,
        }
      : toolUse;

  emit({
    type: "assistant_part",
    externalSessionId: session.externalSessionId,
    timestamp,
    part: createClaudeRunningToolPart({
      messageId,
      startedAtMs,
      toolUse: effectiveToolUse,
    }),
  });
};
