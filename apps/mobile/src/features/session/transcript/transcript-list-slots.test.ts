import { describe, expect, test } from "bun:test";
import { isNearListStart, jumpSlot, placeOf } from "./transcript-list-slots";

describe("transcript list slots", () => {
  test("a jump within the kind on screen shows the partner list", () => {
    expect(jumpSlot("latestA", "latest")).toBe("latestB");
    expect(jumpSlot("latestB", "latest")).toBe("latestA");
    expect(jumpSlot("firstA", "first")).toBe("firstB");
    expect(jumpSlot("firstB", "first")).toBe("firstA");
  });

  test("a jump to the other kind shows the main list of that kind", () => {
    expect(jumpSlot("latestB", "first")).toBe("firstA");
    expect(jumpSlot("firstB", "latest")).toBe("latestA");
  });

  test("measures the near jump distance from the start of each kind", () => {
    const place = { fromTop: 300, fromBottom: 5000, viewportHeight: 800 };
    expect(isNearListStart("first", place)).toBe(true);
    expect(isNearListStart("latest", place)).toBe(false);
    expect(isNearListStart("latest", { ...place, fromBottom: 1600 })).toBe(true);
    expect(isNearListStart("latest", { ...place, fromBottom: 1601 })).toBe(false);
  });

  test("measures the offset of the latest list from the bottom and of the first list from the top", () => {
    expect(placeOf("latest", 100, 5000, 800)).toEqual({
      fromBottom: 100,
      fromTop: 4100,
      viewportHeight: 800,
    });
    expect(placeOf("first", 100, 5000, 800)).toEqual({
      fromTop: 100,
      fromBottom: 4100,
      viewportHeight: 800,
    });
  });

  test("places each list near its start from its offset only", () => {
    for (const kind of ["latest", "first"] as const) {
      expect(isNearListStart(kind, placeOf(kind, 1600, 5000, 800))).toBe(true);
      expect(isNearListStart(kind, placeOf(kind, 1601, 5000, 800))).toBe(false);
      expect(isNearListStart(kind, placeOf(kind, 1601, 90000, 800))).toBe(false);
    }
  });
});
