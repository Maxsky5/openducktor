import { describe, expect, test } from "bun:test";
import { readStringArrayProp } from "./guards";

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
});
