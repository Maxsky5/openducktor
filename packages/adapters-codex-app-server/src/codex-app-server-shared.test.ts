import { describe, expect, test } from "bun:test";
import { arrayFromCodexJsonValue, isPlainObject } from "./codex-app-server-shared";

describe("Codex app-server JSON guards", () => {
  test("isPlainObject accepts only JSON objects", () => {
    expect(isPlainObject({ nested: { values: [1, true, null] } })).toBe(true);
    expect(isPlainObject(["not", "an", "object"])).toBe(false);
    expect(isPlainObject("text")).toBe(false);
    expect(isPlainObject(null)).toBe(false);
  });

  test("arrayFromCodexJsonValue returns arrays from JSON values", () => {
    expect(arrayFromCodexJsonValue([1, { ok: true }, null])).toEqual([1, { ok: true }, null]);
    expect(arrayFromCodexJsonValue({ items: ["one", "two"] })).toEqual(["one", "two"]);
    expect(arrayFromCodexJsonValue({ items: "not-an-array" })).toEqual([]);
    expect(arrayFromCodexJsonValue(undefined)).toEqual([]);
  });
});
