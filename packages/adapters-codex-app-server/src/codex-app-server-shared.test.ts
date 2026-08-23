import { describe, expect, test } from "bun:test";
import { arrayFromUnknown, isPlainObject } from "./codex-app-server-shared";

describe("Codex app-server JSON guards", () => {
  test("isPlainObject validates the full JSON value", () => {
    expect(isPlainObject({ nested: { values: [1, true, null] } })).toBe(true);
    expect(isPlainObject(new Date())).toBe(false);
    expect(isPlainObject({ callback: () => undefined })).toBe(false);
    expect(isPlainObject({ nested: { value: undefined } })).toBe(false);
  });

  test("arrayFromUnknown returns only validated JSON arrays", () => {
    expect(arrayFromUnknown([1, { ok: true }, null])).toEqual([1, { ok: true }, null]);
    expect(arrayFromUnknown({ items: ["one", "two"] })).toEqual(["one", "two"]);
    expect(arrayFromUnknown([() => undefined])).toEqual([]);
    expect(arrayFromUnknown({ items: [new Date()] })).toEqual([]);
  });
});
