import { describe, expect, test } from "bun:test";
import { isRecord, isUnknownRecord } from "./guards";

describe("guards", () => {
  test("isUnknownRecord returns true for plain objects", () => {
    expect(isUnknownRecord({ key: "value" })).toBe(true);
    expect(isUnknownRecord(Object.create(null))).toBe(true);
  });

  test("isUnknownRecord returns false for non-plain objects and primitives", () => {
    class ExampleClass {
      readonly id = "example";
    }

    expect(isUnknownRecord(new Date())).toBe(false);
    expect(isUnknownRecord(new ExampleClass())).toBe(false);
    expect(isUnknownRecord(null)).toBe(false);
    expect(isUnknownRecord([])).toBe(false);
    expect(isUnknownRecord("value")).toBe(false);
    expect(isUnknownRecord(123)).toBe(false);
    expect(isUnknownRecord(false)).toBe(false);
    expect(isUnknownRecord(() => "value")).toBe(false);
    expect(isUnknownRecord(undefined)).toBe(false);
  });

  test("isRecord is an alias of isUnknownRecord", () => {
    expect(isRecord).toBe(isUnknownRecord);
  });
});
