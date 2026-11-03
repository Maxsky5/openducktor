import { expect, test } from "bun:test";
import { selectionAfterEdit, selectionForTap } from "./pairing-code-selection";

const slotEnds = [40, 86, 132, 184, 230, 276];

test("a tap selects the tapped digit, or puts the caret after the typed digits", () => {
  expect(selectionForTap(slotEnds, 60, "123456")).toEqual({ start: 1, end: 2 });
  expect(selectionForTap(slotEnds, 270, "123456")).toEqual({ start: 5, end: 6 });
  expect(selectionForTap(slotEnds, 200, "12")).toEqual({ start: 2, end: 2 });
  // A tap past the last slot counts as the last slot.
  expect(selectionForTap(slotEnds, 400, "123456")).toEqual({ start: 5, end: 6 });
});

test("a replaced digit selects the next digit, and typing or deleting moves the caret to the end", () => {
  expect(selectionAfterEdit("123456", "193456")).toEqual({ start: 2, end: 3 });
  expect(selectionAfterEdit("123456", "123459")).toEqual({ start: 6, end: 6 });
  expect(selectionAfterEdit("123", "1234")).toEqual({ start: 4, end: 4 });
  expect(selectionAfterEdit("1234", "124")).toEqual({ start: 3, end: 3 });
});
