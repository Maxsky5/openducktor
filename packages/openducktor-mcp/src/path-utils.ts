import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const EMPTY_ENV_SENTINELS = new Set(["undefined", "null"]);
const OPENDUCKTOR_CONFIG_DIR_ENV = "OPENDUCKTOR_CONFIG_DIR";
const DEFAULT_OPENDUCKTOR_CONFIG_DIR_NAME = ".openducktor";
export const MCP_BRIDGE_REGISTRY_RELATIVE_PATH = "runtime/mcp-bridge-ports.json";

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

const stripWrappingQuotes = (value: string): string => {
  if (value.length < 2) {
    return value;
  }

  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1).trim();
  }

  return value;
};

const resolveUserPath = (value: string): string => {
  const normalized = stripWrappingQuotes(value);
  if (normalized === "~") {
    return homedir();
  }
  if (normalized.startsWith("~/") || normalized.startsWith("~\\")) {
    return resolve(homedir(), normalized.slice(2));
  }
  return resolve(normalized);
};

export const resolveOpenducktorBaseDir = (): string => {
  if (Object.hasOwn(process.env, OPENDUCKTOR_CONFIG_DIR_ENV)) {
    const configured = normalizeOptionalInput(process.env[OPENDUCKTOR_CONFIG_DIR_ENV]);
    if (!configured) {
      throw new Error(
        "OPENDUCKTOR_CONFIG_DIR is set but empty; provide a valid directory path for OpenDucktor MCP discovery.",
      );
    }
    return resolveUserPath(configured);
  }

  const home = homedir();
  if (!home) {
    throw new Error("Unable to resolve the user home directory for OpenDucktor MCP discovery.");
  }
  return join(home, DEFAULT_OPENDUCKTOR_CONFIG_DIR_NAME);
};

export const resolveMcpBridgeRegistryPath = (): string =>
  join(resolveOpenducktorBaseDir(), MCP_BRIDGE_REGISTRY_RELATIVE_PATH);

export const resolveCanonicalPath = async (path: string): Promise<string> => {
  const resolved = resolve(path);
  try {
    return await realpath(resolved);
  } catch {
    return resolved;
  }
};

export const normalizeBaseUrl = (value: string): string =>
  value.endsWith("/") ? value.slice(0, -1) : value;
