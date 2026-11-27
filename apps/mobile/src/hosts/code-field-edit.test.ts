import { expect, test } from "bun:test";
import { selectionForSlot } from "@openducktor/frontend-core/lib/pairing-code-selection";
import { editAtCaret } from "./code-field-edit";

// Each row: the code, the selected slot, the field text after the change, the inserted text that
// iOS reported, then the expected code and selection.
type Row = [string, number, string, string | null, string, { start: number; end: number }];

const check = ([value, slot, text, inserted, code, selection]: Row) =>
  expect(editAtCaret(value, selectionForSlot(slot, value), text, inserted)).toEqual({
    code,
    selection,
  });

test("a digit typed over a selected digit replaces it and selects the next digit", () => {
  const rows: Row[] = [
    ["1234", 1, "12934", "9", "1934", { start: 2, end: 3 }],
    ["12345", 4, "123456", "6", "12346", { start: 5, end: 5 }],
    ["123456", 0, "1723456", "7", "723456", { start: 1, end: 2 }],
    ["123456", 5, "1234567", "7", "123457", { start: 6, end: 6 }],
  ];
  rows.forEach(check);
});

test("the same digit typed over a selected digit still selects the next digit", () => {
  check(["123456", 2, "1233456", "3", "123456", { start: 3, end: 4 }]);
});

test("an autofill that replaces the whole field keeps the complete code", () => {
  const rows: Row[] = [
    ["1", 0, "123456", "123456", "123456", { start: 6, end: 6 }],
    ["12", 1, "123456", "123456", "123456", { start: 6, end: 6 }],
    ["12345", 4, "123456", "123456", "123456", { start: 6, end: 6 }],
    ["12345", 4, "123456", null, "123456", { start: 6, end: 6 }],
    ["12", 0, "654 321", null, "654321", { start: 6, end: 6 }],
  ];
  rows.forEach(check);
});

test("a Backspace or a digit at the caret changes the end of the code", () => {
  const rows: Row[] = [
    // Backspace at the caret after the selected digit removes that digit.
    ["12345", 2, "1245", null, "1245", { start: 4, end: 4 }],
    ["12", 2, "123", "3", "123", { start: 3, end: 3 }],
    ["123456", 6, "1234567", "7", "123456", { start: 6, end: 6 }],
  ];
  rows.forEach(check);
});
