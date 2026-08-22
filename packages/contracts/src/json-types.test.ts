import { describe, expect, test } from "bun:test";
import { isJsonObject } from "./json-types";

describe("JSON type guards", () => {
  test("accepts records and rejects every other JSON value", () => {
    expect(isJsonObject({ answer: 42 })).toBe(true);
    expect(isJsonObject([])).toBe(false);
    expect(isJsonObject(null)).toBe(false);
    expect(isJsonObject("value")).toBe(false);
    expect(isJsonObject(undefined)).toBe(false);
  });
});
