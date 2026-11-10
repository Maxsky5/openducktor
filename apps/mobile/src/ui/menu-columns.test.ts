import { describe, expect, test } from "bun:test";
import { MENU_COLUMN_WIDTH, menuColumnCount, splitMenuColumns } from "./menu-columns";

describe("menuColumnCount", () => {
  const portrait = { width: 411, height: 860 };
  const landscape = { width: 860, height: 390 };

  test("keeps one column when the items fit the window height", () => {
    expect(
      menuColumnCount({
        itemsHeight: 460,
        headingHeight: 34,
        window: portrait,
        columnWidth: MENU_COLUMN_WIDTH,
      }),
    ).toBe(1);
    expect(
      menuColumnCount({
        itemsHeight: 184,
        headingHeight: 34,
        window: landscape,
        columnWidth: MENU_COLUMN_WIDTH,
      }),
    ).toBe(1);
  });

  test("puts a menu that is taller than a low window in columns", () => {
    expect(
      menuColumnCount({
        itemsHeight: 460,
        headingHeight: 34,
        window: landscape,
        columnWidth: MENU_COLUMN_WIDTH,
      }),
    ).toBe(2);
    expect(
      menuColumnCount({
        itemsHeight: 900,
        headingHeight: 34,
        window: landscape,
        columnWidth: MENU_COLUMN_WIDTH,
      }),
    ).toBe(3);
  });

  test("keeps the columns that the window width allows", () => {
    expect(
      menuColumnCount({
        itemsHeight: 2000,
        headingHeight: 0,
        window: portrait,
        columnWidth: MENU_COLUMN_WIDTH,
      }),
    ).toBe(1);
    expect(
      menuColumnCount({
        itemsHeight: 2000,
        headingHeight: 0,
        window: { width: 560, height: 390 },
        columnWidth: MENU_COLUMN_WIDTH,
      }),
    ).toBe(2);
  });

  test("keeps enlarged columns inside the window instead of using the default width", () => {
    expect(
      menuColumnCount({ itemsHeight: 900, headingHeight: 34, window: landscape, columnWidth: 496 }),
    ).toBe(1);
  });
});

describe("splitMenuColumns", () => {
  test("fills the columns from top to bottom in item order", () => {
    expect(splitMenuColumns([1, 2, 3, 4, 5], 2)).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
    expect(splitMenuColumns([1, 2], 3)).toEqual([[1], [2]]);
    expect(splitMenuColumns([1, 2, 3], 1)).toEqual([[1, 2, 3]]);
  });
});
