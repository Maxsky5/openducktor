import { describe, expect, test } from "bun:test";
import { asJsonObject, readStringArrayProp } from "./guards";

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

  test("asJsonObject rejects non-record values", () => {
    expect(asJsonObject("not an object")).toBeUndefined();
    expect(asJsonObject([])).toBeUndefined();
    expect(asJsonObject(null)).toBeUndefined();
  });

  test("asJsonObject preserves producer-declared JSON values", () => {
    expect(asJsonObject({ enabled: true, nested: { value: null } })).toEqual({
      enabled: true,
      nested: { value: null },
    });
  });
});
