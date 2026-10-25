import { describe, expect, test } from "bun:test";
import { isNearListStart, jumpSlot } from "./transcript-list-slots";

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
});
