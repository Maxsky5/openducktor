import { describe, expect, test } from "bun:test";
import { relativizeDisplayPathsInValue } from "./tool-path-utils";

describe("tool-path-utils", () => {
  test("relativizes string arrays for plural path keys", () => {
    expect(
      relativizeDisplayPathsInValue(
        {
          files: ["/repo/src/a.ts", "/repo/src/b.ts"],
          paths: ["/repo/docs/spec.md"],
        },
        "/repo",
      ),
    ).toEqual({
      files: ["src/a.ts", "src/b.ts"],
      paths: ["docs/spec.md"],
    });
  });

  test("preserves non-path arrays when the parent key is not path-like", () => {
    expect(
      relativizeDisplayPathsInValue(
        {
          labels: ["/repo/src/a.ts", "/repo/src/b.ts"],
        },
        "/repo",
      ),
    ).toEqual({
      labels: ["/repo/src/a.ts", "/repo/src/b.ts"],
    });
  });
});
