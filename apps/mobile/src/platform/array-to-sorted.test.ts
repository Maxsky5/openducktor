import { describe, expect, test } from "bun:test";
import { sortedCopy } from "./array-to-sorted";

describe("sortedCopy", () => {
  test("returns a sorted copy and keeps the source order", () => {
    const source = [3, 1, 2];
    const sorted = sortedCopy(source, (left, right) => left - right);
    expect(sorted).toEqual([1, 2, 3]);
    expect(source).toEqual([3, 1, 2]);
    expect(sorted).not.toBe(source);
  });

  test("matches the platform method without a comparison function", () => {
    const source = ["b", "a", "c", "10", "9"];
    expect(sortedCopy(source)).toEqual(source.toSorted());
  });
});
