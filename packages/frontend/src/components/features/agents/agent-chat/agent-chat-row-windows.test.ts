import { describe, expect, test } from "bun:test";
import {
  AGENT_CHAT_ROW_WINDOW_SIZE,
  AGENT_CHAT_ROW_WINDOW_STEP,
  buildAgentChatRowWindows,
  selectTurnAnchorsForWindow,
} from "./agent-chat-row-windows";

describe("agent chat row windows", () => {
  test("builds one bounded window for short transcripts", () => {
    expect(buildAgentChatRowWindows(3)).toEqual([{ index: 0, startRow: 0, endRowExclusive: 3 }]);
  });

  test("builds row-count based windows with a latest window ending at rowCount", () => {
    const rowCount = AGENT_CHAT_ROW_WINDOW_SIZE + AGENT_CHAT_ROW_WINDOW_STEP + 25;

    expect(buildAgentChatRowWindows(rowCount)).toEqual([
      { index: 0, startRow: 0, endRowExclusive: AGENT_CHAT_ROW_WINDOW_SIZE },
      {
        index: 1,
        startRow: AGENT_CHAT_ROW_WINDOW_STEP,
        endRowExclusive: AGENT_CHAT_ROW_WINDOW_STEP + AGENT_CHAT_ROW_WINDOW_SIZE,
      },
      {
        index: 2,
        startRow: rowCount - AGENT_CHAT_ROW_WINDOW_SIZE,
        endRowExclusive: rowCount,
      },
    ]);
  });

  test("clips turn anchors to the selected row window", () => {
    expect(
      selectTurnAnchorsForWindow(
        [
          { key: "a", startRow: 0, endRowExclusive: 5 },
          { key: "b", startRow: 5, endRowExclusive: 12 },
          { key: "c", startRow: 12, endRowExclusive: 20 },
        ],
        { startRow: 8, endRowExclusive: 15 },
      ),
    ).toEqual([
      { key: "b", startRow: 0, endRowExclusive: 4 },
      { key: "c", startRow: 4, endRowExclusive: 7 },
    ]);
  });
});
