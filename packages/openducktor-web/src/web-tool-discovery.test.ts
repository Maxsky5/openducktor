import { describe, expect, test } from "bun:test";
import { resolveWebProvidedToolPaths } from "./web-tool-discovery";

describe("resolveWebProvidedToolPaths", () => {
  test("provides the active Bun executable to host tool discovery", () => {
    expect(resolveWebProvidedToolPaths("/usr/local/bin/bun")).toEqual({
      bun: "/usr/local/bin/bun",
    });
  });
});
