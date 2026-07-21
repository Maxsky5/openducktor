import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { normalizeUserPathInput, resolveNormalizedUserPath } from "@openducktor/path-support";

const EMPTY_ENV_SENTINELS = new Set(["undefined", "null"]);
const OPENDUCKTOR_CHANNEL_ENV = "OPENDUCKTOR_CHANNEL";
const OPENDUCKTOR_CONFIG_DIR_ENV = "OPENDUCKTOR_CONFIG_DIR";
const DEFAULT_OPENDUCKTOR_CONFIG_DIR_NAME = ".openducktor";
const DEVELOPMENT_MCP_BRIDGE_DISCOVERY_RELATIVE_PATH = "runtime/mcp-bridge-dev.json";
const PRODUCTION_MCP_BRIDGE_DISCOVERY_RELATIVE_PATH = "runtime/mcp-bridge.json";

export const normalizeOptionalInput = (value: string | undefined): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (EMPTY_ENV_SENTINELS.has(trimmed.toLowerCase())) {
    return undefined;
  }
  return trimmed;
};

const resolveHomeDirectory = (): string => {
  const home = homedir();
  if (!home) {
    throw new Error("Unable to resolve the user home directory for OpenDucktor MCP discovery.");
  }
  return home;
};

const resolveMcpUserPath = (normalized: string): string => {
  const expanded = resolveNormalizedUserPath(normalized, {
    resolveHomeDir: resolveHomeDirectory,
    joinHomePath: (homeDir, relativePath) => resolve(homeDir, relativePath),
  });
  return resolve(expanded);
};

const resolveOpenducktorBaseDir = (): string => {
  if (Object.hasOwn(process.env, OPENDUCKTOR_CONFIG_DIR_ENV)) {
    const configured = normalizeOptionalInput(process.env[OPENDUCKTOR_CONFIG_DIR_ENV]);
    const normalized = configured ? normalizeUserPathInput(configured) : undefined;
    if (!normalized) {
      throw new Error(
        "OPENDUCKTOR_CONFIG_DIR is set but empty; provide a valid directory path for OpenDucktor MCP discovery.",
      );
    }
    return resolveMcpUserPath(normalized);
  }

  return join(resolveHomeDirectory(), DEFAULT_OPENDUCKTOR_CONFIG_DIR_NAME);
};

const resolveMcpBridgeDiscoveryRelativePath = (): string => {
  if (!Object.hasOwn(process.env, OPENDUCKTOR_CHANNEL_ENV)) {
    return PRODUCTION_MCP_BRIDGE_DISCOVERY_RELATIVE_PATH;
  }
  const channel = process.env[OPENDUCKTOR_CHANNEL_ENV];
  if (channel === "dev") {
    return DEVELOPMENT_MCP_BRIDGE_DISCOVERY_RELATIVE_PATH;
  }
  throw new Error(
    `OPENDUCKTOR_CHANNEL must be unset for production discovery or set to dev. Received ${JSON.stringify(channel)}.`,
  );
};

export const resolveMcpBridgeDiscoveryPath = (): string =>
  join(resolveOpenducktorBaseDir(), resolveMcpBridgeDiscoveryRelativePath());

export const normalizeBaseUrl = (value: string): string =>
  value.endsWith("/") ? value.slice(0, -1) : value;
