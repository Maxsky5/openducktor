import { describe, expect, test } from "bun:test";
import { formatElapsedAgo, formatElapsedShort } from "./relative-time";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatElapsedShort", () => {
  test("names each unit with its largest whole count", () => {
    expect(formatElapsedShort(59_999)).toBe("now");
    expect(formatElapsedShort(6 * MINUTE)).toBe("6m");
    expect(formatElapsedShort(2 * HOUR + 5 * MINUTE)).toBe("2h");
    expect(formatElapsedShort(3 * DAY)).toBe("3d");
    expect(formatElapsedShort(4 * 30 * DAY)).toBe("4mo");
    expect(formatElapsedShort(366 * DAY)).toBe("1y");
  });

  test("treats a time in the future as now", () => {
    expect(formatElapsedShort(-5 * MINUTE)).toBe("now");
  });
});

describe("formatElapsedAgo", () => {
  test("reads as a sentence part", () => {
    expect(formatElapsedAgo(10_000)).toBe("just now");
    expect(formatElapsedAgo(6 * MINUTE)).toBe("6m ago");
  });
});
