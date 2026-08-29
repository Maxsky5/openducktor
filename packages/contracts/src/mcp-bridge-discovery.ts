import { z } from "zod";
import type { DevelopmentInstanceId } from "./development-instance";

const nonEmptyDiscoveryValueSchema = z.string().refine((value) => value.trim().length > 0);

export const mcpBridgeDiscoveryFileSchema = z.object({
  hostUrl: nonEmptyDiscoveryValueSchema,
  hostToken: nonEmptyDiscoveryValueSchema,
  pid: z.number().int().positive(),
});

export type McpBridgeDiscoveryFile = z.output<typeof mcpBridgeDiscoveryFileSchema>;

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
