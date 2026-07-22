import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveMcpBridgeDiscoveryPath } from "./path-utils";

let previousConfigDir: string | undefined;
let previousChannel: string | undefined;

beforeEach(() => {
  previousConfigDir = process.env.OPENDUCKTOR_CONFIG_DIR;
  previousChannel = process.env.OPENDUCKTOR_CHANNEL;
  delete process.env.OPENDUCKTOR_CONFIG_DIR;
  delete process.env.OPENDUCKTOR_CHANNEL;
});

afterEach(() => {
  if (previousConfigDir === undefined) {
    delete process.env.OPENDUCKTOR_CONFIG_DIR;
  } else {
    process.env.OPENDUCKTOR_CONFIG_DIR = previousConfigDir;
  }
  if (previousChannel === undefined) {
    delete process.env.OPENDUCKTOR_CHANNEL;
  } else {
    process.env.OPENDUCKTOR_CHANNEL = previousChannel;
  }
});

describe("MCP path utilities", () => {
  test("defaults external discovery to the production descriptor", () => {
    expect(resolveMcpBridgeDiscoveryPath()).toBe(
      join(homedir(), ".openducktor", "runtime", "mcp-bridge.json"),
    );
  });

  test("selects the development descriptor for the dev channel", () => {
    process.env.OPENDUCKTOR_CHANNEL = "dev";

    expect(resolveMcpBridgeDiscoveryPath()).toBe(
      join(homedir(), ".openducktor", "runtime", "mcp-bridge-dev.json"),
    );
  });

  test.each(["", "   ", "production", "preview"])(
    "rejects unsupported external discovery channel %p",
    (channel) => {
      process.env.OPENDUCKTOR_CHANNEL = channel;

      expect(() => resolveMcpBridgeDiscoveryPath()).toThrow(
        "OPENDUCKTOR_CHANNEL must be unset for production discovery or set to dev",
      );
    },
  );

  test("expands quoted home-relative config directories", () => {
    process.env.OPENDUCKTOR_CONFIG_DIR = ` "~/.openducktor-local" `;

    expect(resolveMcpBridgeDiscoveryPath()).toBe(
      join(homedir(), ".openducktor-local", "runtime", "mcp-bridge.json"),
    );
  });

  test("rejects quoted empty config directories", () => {
    process.env.OPENDUCKTOR_CONFIG_DIR = `"   "`;

    expect(() => resolveMcpBridgeDiscoveryPath()).toThrow(
      "OPENDUCKTOR_CONFIG_DIR is set but empty",
    );
  });
});
