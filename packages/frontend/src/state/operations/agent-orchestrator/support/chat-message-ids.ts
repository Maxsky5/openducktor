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
