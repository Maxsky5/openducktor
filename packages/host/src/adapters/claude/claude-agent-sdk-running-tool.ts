import type { ClaudeEventSession } from "./claude-agent-sdk-event-session";
import {
  type ClaudeDecodedToolUse,
  createClaudeRunningToolPart,
} from "./claude-agent-sdk-tool-shapes";
import type { ClaudeAgentSdkEvent } from "./claude-agent-sdk-types";

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
