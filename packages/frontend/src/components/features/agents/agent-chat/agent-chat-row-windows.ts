import type { AgentChatTurnAnchor } from "./agent-chat-transcript-model";

export const AGENT_CHAT_ROW_WINDOW_SIZE = 40;
export const AGENT_CHAT_ROW_WINDOW_EDGE_PRELOAD_COUNT = 10;

export type AgentChatRowWindow = {
  index: number;
  startRow: number;
  endRowExclusive: number;
};

export function buildAgentChatRowWindows(rowCount: number): AgentChatRowWindow[] {
  const startRow = Math.max(0, rowCount - AGENT_CHAT_ROW_WINDOW_SIZE);
  return [
    {
      index: 0,
      startRow,
      endRowExclusive: rowCount,
    },
  ];
}

export function selectTurnAnchorsForWindow(
  turnAnchors: AgentChatTurnAnchor[],
  window: Pick<AgentChatRowWindow, "startRow" | "endRowExclusive">,
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
