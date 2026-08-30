import type { AgentChatMessage } from "@/types/agent-orchestrator";

export type MessageTimestamp = Pick<AgentChatMessage, "timestamp" | "timestampIsApproximate">;

export const preferredMessageTimestamp = (
  preferred: MessageTimestamp,
  alternative: MessageTimestamp,
): MessageTimestamp => {
  if (preferred.timestampIsApproximate && !alternative.timestampIsApproximate) {
    return { timestamp: alternative.timestamp };
  }
  const timestamp: MessageTimestamp = { timestamp: preferred.timestamp };
  if (preferred.timestampIsApproximate) timestamp.timestampIsApproximate = true;
  return timestamp;
};

export const applyMessageTimestamp = (
  message: AgentChatMessage,
  timestamp: MessageTimestamp,
): AgentChatMessage => {
  const { timestampIsApproximate: _discardedAccuracy, ...messageWithoutTimestampAccuracy } =
    message;
  const timestampedMessage: AgentChatMessage = {
    ...messageWithoutTimestampAccuracy,
    timestamp: timestamp.timestamp,
  };
  if (timestamp.timestampIsApproximate) {
    timestampedMessage.timestampIsApproximate = true;
  }
  return timestampedMessage;
};

export const applyPreferredMessageTimestamp = (
  message: AgentChatMessage,
  preferred: MessageTimestamp,
  alternative: MessageTimestamp,
): AgentChatMessage =>
  applyMessageTimestamp(message, preferredMessageTimestamp(preferred, alternative));

export const haveSameMessageTimestamp = (
  left: MessageTimestamp,
  right: MessageTimestamp,
): boolean =>
  left.timestamp === right.timestamp &&
  left.timestampIsApproximate === right.timestampIsApproximate;
