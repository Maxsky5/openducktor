import type { AgentChatTranscriptRow } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";

const isUserMessageItem = (item: AgentChatTranscriptRow | undefined): boolean =>
  item?.kind === "message" && item.message.role === "user";

/**
 * The last user message before `anchorIndex`, or null. `anchorIndex` is the first item in view,
 * so a press moves to the user message above the reader. The scan stops at the first match.
 */
export const previousUserMessageIndex = (
  items: readonly AgentChatTranscriptRow[],
  anchorIndex: number,
): number | null => {
  for (let index = Math.min(anchorIndex, items.length) - 1; index >= 0; index -= 1) {
    if (isUserMessageItem(items[index])) return index;
  }
  return null;
};

/** The first user message after `anchorIndex`, or null. */
export const nextUserMessageIndex = (
  items: readonly AgentChatTranscriptRow[],
  anchorIndex: number,
): number | null => {
  for (let index = Math.max(anchorIndex + 1, 0); index < items.length; index += 1) {
    if (isUserMessageItem(items[index])) return index;
  }
  return null;
};
