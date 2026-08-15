export const OPENDUCKTOR_DEV_INSTANCE_ENV = "OPENDUCKTOR_DEV_INSTANCE";

export type DevelopmentInstanceMode = "browser" | "electron";

export const DEVELOPMENT_INSTANCE_ID_PATTERN = /^(browser|electron)-[a-f0-9]{12}$/u;

export const PRODUCTION_MCP_BRIDGE_DISCOVERY_PATH_SEGMENTS = [
  "runtime",
  "mcp-bridge.json",
] as const;

export const isDevelopmentInstanceId = (value: string): boolean =>
  DEVELOPMENT_INSTANCE_ID_PATTERN.test(value);

export const developmentMcpBridgeDiscoveryPathSegments = (
  developmentInstanceId: string,
): readonly string[] => ["runtime", "dev-instances", developmentInstanceId, "mcp-bridge.json"];
