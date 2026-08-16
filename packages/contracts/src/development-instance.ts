export const OPENDUCKTOR_DEV_INSTANCE_ENV = "OPENDUCKTOR_DEV_INSTANCE";

export type DevelopmentInstanceMode = "browser" | "electron";

declare const DEVELOPMENT_INSTANCE_ID_BRAND: unique symbol;
export type DevelopmentInstanceId = string & {
  readonly [DEVELOPMENT_INSTANCE_ID_BRAND]: true;
};

export const DEVELOPMENT_INSTANCE_ID_PATTERN = /^(browser|electron)-[a-f0-9]{12}$/u;

export const PRODUCTION_MCP_BRIDGE_DISCOVERY_PATH_SEGMENTS = [
  "runtime",
  "mcp-bridge.json",
] as const;

export const isDevelopmentInstanceId = (value: string): value is DevelopmentInstanceId =>
  DEVELOPMENT_INSTANCE_ID_PATTERN.test(value);

export const developmentMcpBridgeDiscoveryPathSegments = (
  developmentInstanceId: DevelopmentInstanceId,
): readonly string[] => ["runtime", "dev-instances", developmentInstanceId, "mcp-bridge.json"];
