import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { hasRuntimeType } from "@openducktor/contracts";

export const readClaudeSdkMessageTimestamp = (message: SDKMessage, now: () => string): string => {
  // SAFETY: Claude SDK messages may carry a runtime timestamp that its public union omits.
  const timestamp = (message as { timestamp?: unknown }).timestamp;
  if (!hasRuntimeType(timestamp, "string")) return now();
  return Number.isNaN(Date.parse(timestamp)) ? now() : timestamp;
};
