import type { ClaudeSdkMessageProjection } from "./claude-agent-sdk-message-projection";

export const readClaudeSdkMessageTimestamp = (
  message: ClaudeSdkMessageProjection,
  now: () => string,
): string => {
  const timestamp = "timestamp" in message ? message.timestamp : undefined;
  if (timestamp === undefined) return now();
  return Number.isNaN(Date.parse(timestamp)) ? now() : timestamp;
};

export const claudeReplyDurationMs = (
  startedAt: string | undefined,
  finishedAt: string | undefined,
): number | undefined => {
  if (startedAt === undefined || finishedAt === undefined) return undefined;
  const durationMs = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : undefined;
};
