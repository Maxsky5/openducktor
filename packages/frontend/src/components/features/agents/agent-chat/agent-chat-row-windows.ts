import type { AgentChatTurnAnchor } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";

// A 456 px transcript pane holds 9 rows of 56 px. The extra 11 rows keep a 10-row preload above
// the window. A taller pane grows the window after paint.
export const AGENT_CHAT_ROW_WINDOW_SIZE = 20;
export const AGENT_CHAT_ROW_WINDOW_EDGE_PRELOAD_COUNT = 10;

export function selectTurnAnchorsForWindow(
  turnAnchors: AgentChatTurnAnchor[],
  window: { startRow: number; endRowExclusive: number },
): AgentChatTurnAnchor[] {
  return turnAnchors
    .filter(
      (anchor) =>
        anchor.endRowExclusive > window.startRow && anchor.startRow < window.endRowExclusive,
    )
    .map((anchor) => ({
      key: anchor.key,
      startRow: Math.max(anchor.startRow, window.startRow) - window.startRow,
      endRowExclusive: Math.min(anchor.endRowExclusive, window.endRowExclusive) - window.startRow,
    }));
}
