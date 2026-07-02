import type { AgentChatTurnAnchor } from "./agent-chat-transcript-model";

export const AGENT_CHAT_ROW_WINDOW_SIZE = 40;
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
