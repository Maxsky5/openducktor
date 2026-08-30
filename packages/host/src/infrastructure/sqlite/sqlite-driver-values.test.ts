import { describe, expect, test } from "bun:test";

import { sqliteRowSchema } from "./sqlite-driver-values";

class RowLikeValue {
  readonly label = "alpha";
}

describe("sqliteRowSchema", () => {
  test("accepts plain and null-prototype rows", () => {
    expect(sqliteRowSchema.safeParse({ label: "alpha", value: 7 }).success).toBe(true);

    const row = Object.assign(Object.create(null), { label: "alpha", value: 7 });
    expect(sqliteRowSchema.safeParse(row).success).toBe(true);
  });

  test("rejects objects that are not SQLite row records", () => {
    expect(sqliteRowSchema.safeParse(new Date()).success).toBe(false);
    expect(sqliteRowSchema.safeParse(new Uint8Array([1, 2])).success).toBe(false);
    expect(sqliteRowSchema.safeParse(new RowLikeValue()).success).toBe(false);
  });
});
