import { describe, expect, test } from "bun:test";
import { asUnknownRecord, readStringArrayProp } from "./guards";

describe("guards", () => {
  test("readStringArrayProp returns a copied string array for valid input", () => {
    const source = {
      patterns: ["src/**", "docs/**"],
    };

    const result = readStringArrayProp(source, "patterns");
    expect(result).toEqual(["src/**", "docs/**"]);
    expect(result).not.toBe(source.patterns);
  });

  test("readStringArrayProp returns undefined when any entry is non-string", () => {
    const result = readStringArrayProp({ patterns: ["src/**", 42] }, "patterns");
    expect(result).toBeUndefined();
  });

  test("asUnknownRecord rejects non-record values", () => {
    expect(asUnknownRecord(new Date())).toBeUndefined();
    expect(asUnknownRecord([])).toBeUndefined();
    expect(asUnknownRecord(null)).toBeUndefined();
  });

  test("asUnknownRecord preserves producer-declared unknown values", () => {
    const callback = () => undefined;
    expect(asUnknownRecord({ callback, nested: { value: undefined } })).toEqual({
      callback,
      nested: { value: undefined },
    });
  });
});
