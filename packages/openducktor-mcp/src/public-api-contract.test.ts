import { describe, expect, test } from "bun:test";
import packageJson from "../package.json" with { type: "json" };

describe("public API contract", () => {
  test("package root stays intentionally empty", async () => {
    const api = await import("./index");
    expect(Object.keys(api)).toEqual([]);
  });

  test("package metadata keeps the CLI separate from the published root", () => {
    expect(packageJson.main).toBe("./dist/index.js");
    expect(packageJson.types).toBe("./dist/index.d.ts");
    expect(packageJson.bin).toEqual({
      "openducktor-mcp": "./dist/cli.js",
    });
    expect(packageJson.exports).toEqual({
      ".": {
        types: "./dist/index.d.ts",
        default: "./dist/index.js",
      },
    });
  });
});
