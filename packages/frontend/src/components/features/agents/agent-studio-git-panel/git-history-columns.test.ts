import { describe, expect, test } from "bun:test";
import {
  DEFAULT_HISTORY_COLUMNS,
  moveHistoryColumn,
  normalizeHistoryColumns,
  visibleHistoryColumns,
} from "./git-history-columns";

describe("History columns", () => {
  test("starts with the author and the SHA hidden", () => {
    expect(visibleHistoryColumns(DEFAULT_HISTORY_COLUMNS)).toEqual([
      "refs",
      "graph",
      "message",
      "date",
    ]);
  });

  test("moves a column to the place of another column", () => {
    const order = DEFAULT_HISTORY_COLUMNS.order;
    expect(moveHistoryColumn(order, "date", 0)).toEqual([
      "date",
      "refs",
      "graph",
      "message",
      "author",
      "sha",
    ]);
    expect(moveHistoryColumn(order, "refs", 99)).toEqual([
      "graph",
      "message",
      "author",
      "date",
      "sha",
      "refs",
    ]);
  });

  test("repairs a saved choice: one entry each, new columns in place, message always shown", () => {
    expect(
      normalizeHistoryColumns({
        order: ["message", "graph", "message", "date"],
        hidden: ["message", "author", "author"],
      }),
    ).toEqual({
      // A missing column returns at its default place.
      order: ["refs", "message", "graph", "author", "date", "sha"],
      hidden: ["author"],
    });
  });
});
