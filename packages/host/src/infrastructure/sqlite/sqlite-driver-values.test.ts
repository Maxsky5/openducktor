import { describe, expect, test } from "bun:test";

import { isSqliteRow } from "./sqlite-driver-values";

class RowLikeValue {
  readonly label = "alpha";
}

describe("isSqliteRow", () => {
  test("accepts plain and null-prototype rows", () => {
    expect(isSqliteRow({ label: "alpha", value: 7 })).toBe(true);

    const row = Object.assign(Object.create(null), { label: "alpha", value: 7 });
    expect(isSqliteRow(row)).toBe(true);
  });

  test("rejects objects that are not SQLite row records", () => {
    expect(isSqliteRow(new Date())).toBe(false);
    expect(isSqliteRow(new Uint8Array([1, 2]))).toBe(false);
    expect(isSqliteRow(new RowLikeValue())).toBe(false);
  });
});
