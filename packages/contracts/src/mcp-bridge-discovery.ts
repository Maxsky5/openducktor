import type { DevelopmentInstanceId } from "./development-instance";

export const MCP_BRIDGE_PRODUCTION_DISCOVERY_PATH_SEGMENTS = [
  "runtime",
  "mcp-bridge.json",
] as const;

export const mcpBridgeDevelopmentDiscoveryPathSegments = (
  developmentInstanceId: DevelopmentInstanceId,
): readonly ["runtime", "dev-instances", DevelopmentInstanceId, "mcp-bridge.json"] => [
  "runtime",
  "dev-instances",
  developmentInstanceId,
  "mcp-bridge.json",
];
