import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";

describe("runtime path contract", () => {
  test("keeps only the host-backed MCP runtime files and explicit public stub in src", () => {
    const files = readdirSync(import.meta.dir)
      .filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"))
      .sort();

    expect(files).toEqual([
      "cli.ts",
      "host-bridge-client.ts",
      "index.ts",
      "lib.ts",
      "odt-task-store.ts",
      "path-utils.ts",
      "store-context.ts",
    ]);
  });
});
