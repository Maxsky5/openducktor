import { describe, expect, test } from "bun:test";
import { resolveWebProvidedToolPaths } from "./web-tool-discovery";

describe("resolveWebProvidedToolPaths", () => {
  test("provides the active Node executable to host tool discovery", () => {
    expect(resolveWebProvidedToolPaths("/usr/local/bin/node")).toEqual({
      node: "/usr/local/bin/node",
    });
  });
});
