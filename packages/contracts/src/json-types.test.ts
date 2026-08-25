import { describe, expect, test } from "bun:test";
import { isJsonObject, jsonObjectSchema } from "./json-types";

describe("JSON type guards", () => {
  test("accepts JSON records and rejects other unknown values", () => {
    expect(isJsonObject({ answer: 42 })).toBe(true);
    expect(isJsonObject({ value: undefined })).toBe(false);
    expect(isJsonObject({ value: () => undefined })).toBe(false);
    expect(isJsonObject([])).toBe(false);
    expect(isJsonObject(null)).toBe(false);
    expect(isJsonObject("value")).toBe(false);
    expect(isJsonObject(undefined)).toBe(false);
  });

  test("parses only JSON objects", () => {
    expect(jsonObjectSchema.parse({ answer: 42, nested: [true, null] })).toEqual({
      answer: 42,
      nested: [true, null],
    });
    expect(jsonObjectSchema.safeParse([]).success).toBe(false);
    expect(jsonObjectSchema.safeParse(new Date()).success).toBe(false);
    expect(jsonObjectSchema.safeParse({ value: undefined }).success).toBe(false);
  });
});
