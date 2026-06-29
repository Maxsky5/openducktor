import type { AgentChatTurnAnchor } from "./agent-chat-transcript-model";

export const AGENT_CHAT_ROW_WINDOW_SIZE = 240;
export const AGENT_CHAT_ROW_WINDOW_STEP = 160;

export type AgentChatRowWindow = {
  index: number;
  startRow: number;
  endRowExclusive: number;
};

export function buildAgentChatRowWindows(rowCount: number): AgentChatRowWindow[] {
  if (rowCount <= AGENT_CHAT_ROW_WINDOW_SIZE) {
    return [{ index: 0, startRow: 0, endRowExclusive: rowCount }];
  }

  const starts: number[] = [];
  for (
    let startRow = 0;
    startRow < rowCount - AGENT_CHAT_ROW_WINDOW_SIZE;
    startRow += AGENT_CHAT_ROW_WINDOW_STEP
  ) {
    starts.push(startRow);
  }

  const latestStartRow = rowCount - AGENT_CHAT_ROW_WINDOW_SIZE;
  if (starts.at(-1) !== latestStartRow) {
    starts.push(latestStartRow);
  }

  return starts.map((startRow, index) => ({
    index,
    startRow,
    endRowExclusive: Math.min(rowCount, startRow + AGENT_CHAT_ROW_WINDOW_SIZE),
  }));
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
