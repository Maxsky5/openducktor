import { describe, expect, test } from "bun:test";
import { keysPastRightEdge } from "./terminal-key-row";

describe("keysPastRightEdge", () => {
  test("reports keys past the right edge until the row scrolls to its end", () => {
    expect(keysPastRightEdge({ offset: 0, viewport: 300, content: 420 })).toBe(true);
    expect(keysPastRightEdge({ offset: 118, viewport: 300, content: 420 })).toBe(true);
    expect(keysPastRightEdge({ offset: 120, viewport: 300, content: 420 })).toBe(false);
  });

  test("reports no hidden keys when the row fits or is not measured yet", () => {
    expect(keysPastRightEdge({ offset: 0, viewport: 500, content: 420 })).toBe(false);
    expect(keysPastRightEdge({ offset: 0, viewport: 420.5, content: 421 })).toBe(false);
    expect(keysPastRightEdge({ offset: 0, viewport: 0, content: 420 })).toBe(false);
  });
});
