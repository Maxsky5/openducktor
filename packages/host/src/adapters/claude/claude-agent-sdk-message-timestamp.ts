import { z } from "zod";
import type { ClaudeSdkMessageProjection } from "./claude-agent-sdk-message-projection";

const sdkMessageTimestampSchema = z.object({ timestamp: z.string().optional() });

export const readClaudeSdkMessageTimestamp = (
  message: ClaudeSdkMessageProjection,
  now: () => string,
): string => {
  const parsed = sdkMessageTimestampSchema.safeParse(message);
  const timestamp = parsed.success ? parsed.data.timestamp : undefined;
  if (timestamp === undefined) return now();
  return Number.isNaN(Date.parse(timestamp)) ? now() : timestamp;
};
