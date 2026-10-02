import { describe, expect, test } from "bun:test";
import { arraysEqual } from "./arrays-equal";

const sameNumber = (left: number, right: number): boolean => left === right;

describe("arraysEqual", () => {
  test("returns true for the same array without comparing its items", () => {
    const items = [1, 2];

    expect(arraysEqual(items, items, () => false)).toBe(true);
  });

  test("compares the items in order with the given function", () => {
    const sameStart = (left: { start: number }, right: { start: number }): boolean =>
      left.start === right.start;

    expect(arraysEqual([{ start: 0 }, { start: 4 }], [{ start: 0 }, { start: 4 }], sameStart)).toBe(
      true,
    );
    expect(arraysEqual([1, 2], [2, 1], sameNumber)).toBe(false);
  });

  test("returns false for arrays of different length", () => {
    expect(arraysEqual([1, 2], [1], sameNumber)).toBe(false);
    expect(arraysEqual([], [1], sameNumber)).toBe(false);
  });
});
