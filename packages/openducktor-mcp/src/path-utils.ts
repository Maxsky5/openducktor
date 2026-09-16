import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  DEVELOPMENT_INSTANCE_ID_PATTERN,
  isDevelopmentInstanceId,
  MCP_BRIDGE_PRODUCTION_DISCOVERY_PATH_SEGMENTS,
  mcpBridgeDevelopmentDiscoveryPathSegments,
  OPENDUCKTOR_CONFIG_DIR_NAMES,
  OPENDUCKTOR_DEV_INSTANCE_ENV,
} from "@openducktor/contracts";
import { normalizeUserPathInput, resolveNormalizedUserPath } from "@openducktor/path-support";

const EMPTY_ENV_SENTINELS = new Set(["undefined", "null"]);
const OPENDUCKTOR_CHANNEL_ENV = "OPENDUCKTOR_CHANNEL";
const OPENDUCKTOR_CONFIG_DIR_ENV = "OPENDUCKTOR_CONFIG_DIR";

export const normalizeOptionalInput = (value: string | undefined): string | undefined => {
  if (value === undefined) {
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

const resolveOpenDucktorBaseDir = (env: NodeJS.ProcessEnv): string => {
  if (Object.hasOwn(env, OPENDUCKTOR_CONFIG_DIR_ENV)) {
    const configured = normalizeOptionalInput(env[OPENDUCKTOR_CONFIG_DIR_ENV]);
    const normalized = configured ? normalizeUserPathInput(configured) : undefined;
    if (!normalized) {
      throw new Error(
        "OPENDUCKTOR_CONFIG_DIR is set but empty; provide a valid directory path for OpenDucktor MCP discovery.",
      );
    }
    return resolveMcpUserPath(normalized);
  }

  return join(
    resolveHomeDirectory(),
    env[OPENDUCKTOR_CHANNEL_ENV] === "dev"
      ? OPENDUCKTOR_CONFIG_DIR_NAMES.dev
      : OPENDUCKTOR_CONFIG_DIR_NAMES.production,
  );
};

const resolveMcpBridgeDiscoverySegments = (env: NodeJS.ProcessEnv): readonly string[] => {
  if (!Object.hasOwn(env, OPENDUCKTOR_CHANNEL_ENV)) {
    return MCP_BRIDGE_PRODUCTION_DISCOVERY_PATH_SEGMENTS;
  }
  const channel = env[OPENDUCKTOR_CHANNEL_ENV];
  if (channel === "dev") {
    const developmentInstanceId = env[OPENDUCKTOR_DEV_INSTANCE_ENV]?.trim();
    if (!developmentInstanceId) {
      throw new Error(
        `${OPENDUCKTOR_DEV_INSTANCE_ENV} is required when ${OPENDUCKTOR_CHANNEL_ENV}=dev.`,
      );
    }
    if (!isDevelopmentInstanceId(developmentInstanceId)) {
      throw new Error(
        `${OPENDUCKTOR_DEV_INSTANCE_ENV} must match ${DEVELOPMENT_INSTANCE_ID_PATTERN.source}. Received ${JSON.stringify(developmentInstanceId)}.`,
      );
    }
    return mcpBridgeDevelopmentDiscoveryPathSegments(developmentInstanceId);
  }
  throw new Error(
    `OPENDUCKTOR_CHANNEL must be unset for production discovery or set to dev. Received ${JSON.stringify(channel)}.`,
  );
};

export const resolveMcpBridgeDiscoveryPath = (env: NodeJS.ProcessEnv = process.env): string =>
  join(resolveOpenDucktorBaseDir(env), ...resolveMcpBridgeDiscoverySegments(env));

export const normalizeBaseUrl = (value: string): string =>
  value.endsWith("/") ? value.slice(0, -1) : value;
