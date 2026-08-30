import type { ClaudeSdkMessageProjection } from "./claude-agent-sdk-message-projection";

export const readClaudeSdkMessageTimestamp = (
  message: ClaudeSdkMessageProjection,
  now: () => string,
): string => {
  const timestamp = "timestamp" in message ? message.timestamp : undefined;
  if (timestamp === undefined) return now();
  return Number.isNaN(Date.parse(timestamp)) ? now() : timestamp;
};
