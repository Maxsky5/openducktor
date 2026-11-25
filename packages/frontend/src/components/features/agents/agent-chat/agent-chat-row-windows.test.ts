import { describe, expect, test } from "bun:test";
import { selectTurnAnchorsForWindow } from "./agent-chat-row-windows";

describe("agent chat row windows", () => {
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
