import { describe, expect, test } from "bun:test";
import packageJson from "../package.json" with { type: "json" };

describe("public API contract", () => {
  test("package root stays intentionally empty", async () => {
    const api = await import("./index");
    expect(Object.keys(api)).toEqual([]);
  });

  test("package metadata keeps the runtime entrypoint at the root while exposing no API", () => {
    expect(packageJson.main).toBe("./dist/index.js");
    expect(packageJson.types).toBe("./dist/index.d.ts");
    expect(packageJson.bin).toEqual({
      "openducktor-mcp": "./dist/index.js",
    });
    expect(packageJson.exports).toEqual({
      ".": {
        types: "./dist/index.d.ts",
        default: "./dist/index.js",
      },
    });
  });
});
