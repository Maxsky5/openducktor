// User rows and assistant rows without text parts use runtime-provided message ids.
// Part-derived assistant rows keep these stable ids through completion and history.
export const toReasoningMessageId = (messageId: string, partId: string): string =>
  `thinking:${messageId}:${partId}`;

export const toTextMessageId = (messageId: string, partId: string): string =>
  `text:${messageId}:${partId}`;

export const toToolMessageId = ({
  messageId,
  partId,
  callId,
}: {
  messageId: string;
  partId: string;
  callId?: string;
}): string => `tool:${messageId}:${callId?.trim() || partId}`;

export const toImageGenerationMessageId = (itemId: string, turnId?: string): string =>
  `image:${JSON.stringify([turnId ?? null, itemId])}`;
