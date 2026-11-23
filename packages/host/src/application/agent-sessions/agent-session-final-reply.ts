/** The last assistant message of a run, which the user sees as its reply. */
export type FinalReply = { readonly messageId: string; readonly at: number };

/** A later assistant message becomes the final reply. A message with an earlier time does not. */
export const withFinalReply = (
  current: FinalReply | undefined,
  messageId: string,
  at: number,
): FinalReply => (!current || at >= current.at ? { messageId, at } : current);

/** A retracted final reply leaves the run with no final reply. */
export const retractFinalReply = (
  current: FinalReply | undefined,
  messageIds: readonly string[],
): FinalReply | undefined =>
  current && messageIds.includes(current.messageId) ? undefined : current;
