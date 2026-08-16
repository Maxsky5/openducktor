import { describe, expect, test } from "bun:test";
import {
  developmentMcpBridgeDiscoveryPathSegments,
  isDevelopmentInstanceId,
  PRODUCTION_MCP_BRIDGE_DISCOVERY_PATH_SEGMENTS,
} from "./development-instance";

describe("development instance contract", () => {
  test.each(["browser-0123456789ab", "electron-abcdef012345"])(
    "accepts development instance %s",
    (developmentInstanceId) => {
      expect(isDevelopmentInstanceId(developmentInstanceId)).toBe(true);
    },
  );

  test.each([
    "browser-0123456789a",
    "browser-0123456789abc",
    "browser-0123456789ag",
    "desktop-0123456789ab",
    "../browser-0123456789ab",
  ])("rejects development instance %s", (developmentInstanceId) => {
    expect(isDevelopmentInstanceId(developmentInstanceId)).toBe(false);
  });

  test("defines production and development MCP discovery paths", () => {
    const developmentInstanceId = "browser-0123456789ab";
    if (!isDevelopmentInstanceId(developmentInstanceId)) {
      throw new Error("Expected a valid development instance fixture.");
    }

    expect(PRODUCTION_MCP_BRIDGE_DISCOVERY_PATH_SEGMENTS).toEqual(["runtime", "mcp-bridge.json"]);
    expect(developmentMcpBridgeDiscoveryPathSegments(developmentInstanceId)).toEqual([
      "runtime",
      "dev-instances",
      "browser-0123456789ab",
      "mcp-bridge.json",
    ]);
  });
});
