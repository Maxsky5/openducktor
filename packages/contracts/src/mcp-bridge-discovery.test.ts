import { describe, expect, test } from "bun:test";
import { isDevelopmentInstanceId } from "./development-instance";
import {
  MCP_BRIDGE_PRODUCTION_DISCOVERY_PATH_SEGMENTS,
  mcpBridgeDiscoveryFileSchema,
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

  test("validates the shared discovery file shape", () => {
    expect(
      mcpBridgeDiscoveryFileSchema.parse({
        hostUrl: "http://127.0.0.1:4200",
        hostToken: "token",
        pid: 123,
      }),
    ).toEqual({
      hostUrl: "http://127.0.0.1:4200",
      hostToken: "token",
      pid: 123,
    });
    expect(
      mcpBridgeDiscoveryFileSchema.safeParse({ hostUrl: " ", hostToken: "token", pid: 123 })
        .success,
    ).toBeFalse();
    expect(
      mcpBridgeDiscoveryFileSchema.safeParse({
        hostUrl: "http://127.0.0.1:4200",
        hostToken: "token",
        pid: 0,
      }).success,
    ).toBeFalse();
  });
});
