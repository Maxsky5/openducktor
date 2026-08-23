import type { AgentChatMessage } from "@/types/agent-orchestrator";

export type MessageTimestamp = Pick<AgentChatMessage, "timestamp" | "timestampIsApproximate">;

export const preferredMessageTimestamp = (
  preferred: MessageTimestamp,
  alternative: MessageTimestamp,
): MessageTimestamp => {
  if (preferred.timestampIsApproximate && !alternative.timestampIsApproximate) {
    return { timestamp: alternative.timestamp };
  }
  return {
    timestamp: preferred.timestamp,
    ...(preferred.timestampIsApproximate ? { timestampIsApproximate: true } : undefined),
  };
};

export const applyMessageTimestamp = <T extends AgentChatMessage>(
  message: T,
  timestamp: MessageTimestamp,
): T => {
  const { timestampIsApproximate: _discardedAccuracy, ...messageWithoutTimestampAccuracy } =
    message;
  // SAFETY: The spread preserves every field of T and replaces only the two timestamp fields declared by AgentChatMessage.
  return {
    ...messageWithoutTimestampAccuracy,
    timestamp: timestamp.timestamp,
    ...(timestamp.timestampIsApproximate ? { timestampIsApproximate: true } : undefined),
  } as T;
};

export const applyPreferredMessageTimestamp = <T extends AgentChatMessage>(
  message: T,
  preferred: MessageTimestamp,
  alternative: MessageTimestamp,
): T => applyMessageTimestamp(message, preferredMessageTimestamp(preferred, alternative));

export const haveSameMessageTimestamp = (
  left: MessageTimestamp,
  right: MessageTimestamp,
): boolean =>
  left.timestamp === right.timestamp &&
  left.timestampIsApproximate === right.timestampIsApproximate;
