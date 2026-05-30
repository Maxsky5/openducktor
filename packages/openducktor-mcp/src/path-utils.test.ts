import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveMcpBridgeDiscoveryPath } from "./path-utils";

let previousConfigDir: string | undefined;

beforeEach(() => {
  previousConfigDir = process.env.OPENDUCKTOR_CONFIG_DIR;
});

afterEach(() => {
  if (previousConfigDir === undefined) {
    delete process.env.OPENDUCKTOR_CONFIG_DIR;
    return;
  }
  process.env.OPENDUCKTOR_CONFIG_DIR = previousConfigDir;
});

describe("MCP path utilities", () => {
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
