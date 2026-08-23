import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const sdkMessageTimestampSchema = z.object({ timestamp: z.string().optional() });

export const readClaudeSdkMessageTimestamp = (message: SDKMessage, now: () => string): string => {
  const parsed = sdkMessageTimestampSchema.safeParse(message);
  const timestamp = parsed.success ? parsed.data.timestamp : undefined;
  if (timestamp === undefined) return now();
  return Number.isNaN(Date.parse(timestamp)) ? now() : timestamp;
};
