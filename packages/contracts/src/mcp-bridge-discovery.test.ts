import { describe, expect, test } from "bun:test";
import { isDevelopmentInstanceId } from "./development-instance";
import {
  MCP_BRIDGE_PRODUCTION_DISCOVERY_PATH_SEGMENTS,
  mcpBridgeDevelopmentDiscoveryPathSegments,
} from "./mcp-bridge-discovery";

describe("MCP bridge discovery contract", () => {
  test("defines production and development paths", () => {
    const developmentInstanceId = "browser-0123456789ab";
    if (!isDevelopmentInstanceId(developmentInstanceId)) {
      throw new Error("Expected a valid development instance fixture.");
    }

    expect(MCP_BRIDGE_PRODUCTION_DISCOVERY_PATH_SEGMENTS).toEqual(["runtime", "mcp-bridge.json"]);
    expect(mcpBridgeDevelopmentDiscoveryPathSegments(developmentInstanceId)).toEqual([
      "runtime",
      "dev-instances",
      "browser-0123456789ab",
      "mcp-bridge.json",
    ]);
  });
});
