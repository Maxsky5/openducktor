// User and final assistant rows use their runtime-provided message ids directly.
// These helpers only build stable chat row ids for assistant part-derived rows.
export const toReasoningMessageId = (messageId: string, partId: string): string =>
  `thinking:${messageId}:${partId}`;

export const toToolMessageId = ({
  messageId,
  partId,
  callId,
}: {
  messageId: string;
  partId: string;
  callId?: string;
}): string => `tool:${messageId}:${callId?.trim() || partId}`;
