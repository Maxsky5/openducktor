import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveMcpBridgeDiscoveryPath } from "./path-utils";

describe("MCP path utilities", () => {
  test("defaults external discovery to the production descriptor", () => {
    expect(resolveMcpBridgeDiscoveryPath({})).toBe(
      join(homedir(), ".openducktor", "runtime", "mcp-bridge.json"),
    );
  });

  test("selects the development descriptor for the dev channel", () => {
    const environment = {
      OPENDUCKTOR_CHANNEL: "dev",
      OPENDUCKTOR_DEV_INSTANCE: "browser-0123456789ab",
    };

    expect(resolveMcpBridgeDiscoveryPath(environment)).toBe(
      join(
        homedir(),
        ".openducktor-dev",
        "runtime",
        "dev-instances",
        "browser-0123456789ab",
        "mcp-bridge.json",
      ),
    );
  });

  test("requires a development instance for the dev channel", () => {
    expect(() => resolveMcpBridgeDiscoveryPath({ OPENDUCKTOR_CHANNEL: "dev" })).toThrow(
      "OPENDUCKTOR_DEV_INSTANCE is required",
    );
  });

  test.each(["", "   ", "production", "preview"])(
    "rejects unsupported external discovery channel %p",
    (channel) => {
      expect(() => resolveMcpBridgeDiscoveryPath({ OPENDUCKTOR_CHANNEL: channel })).toThrow(
        "OPENDUCKTOR_CHANNEL must be unset for production discovery or set to dev",
      );
    },
  );

  test("expands quoted home-relative config directories", () => {
    expect(
      resolveMcpBridgeDiscoveryPath({
        OPENDUCKTOR_CONFIG_DIR: ` "~/.openducktor-local" `,
      }),
    ).toBe(join(homedir(), ".openducktor-local", "runtime", "mcp-bridge.json"));
  });

  test("rejects quoted empty config directories", () => {
    expect(() => resolveMcpBridgeDiscoveryPath({ OPENDUCKTOR_CONFIG_DIR: `"   "` })).toThrow(
      "OPENDUCKTOR_CONFIG_DIR is set but empty",
    );
  });
});
