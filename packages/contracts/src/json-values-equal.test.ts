import { expect, test } from "bun:test";
import { jsonValuesEqual } from "./json-values-equal";

test("compares JSON values by structure and ignores key order and undefined keys", () => {
  expect(jsonValuesEqual({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
  expect(jsonValuesEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
  expect(jsonValuesEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  expect(jsonValuesEqual({ a: 1 }, { a: 1, b: null })).toBe(false);
  expect(jsonValuesEqual([], {})).toBe(false);
  expect(jsonValuesEqual(undefined, null)).toBe(false);
});
