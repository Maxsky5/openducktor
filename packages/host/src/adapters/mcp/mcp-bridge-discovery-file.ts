import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const OPENDUCKTOR_CONFIG_DIR_ENV = "OPENDUCKTOR_CONFIG_DIR";
const DEFAULT_CONFIG_DIR_NAME = ".openducktor";
const DISCOVERY_RELATIVE_PATH = "runtime/mcp-bridge.json";

export type McpBridgeDiscoveryFile = {
  hostToken: string;
  hostUrl: string;
  pid: number;
};

const stripMatchingQuotes = (value: string): string => {
  if (value.length < 2) {
    return value;
  }

  const first = value.at(0);
  const last = value.at(-1);
  if ((first === `"` && last === `"`) || (first === `'` && last === `'`)) {
    return value.slice(1, -1);
  }

  return value;
};

const isFsErrorCode = (error: unknown, code: string): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === code;

const resolveHomeDirectory = (): string => {
  const home = homedir();
  if (home.trim().length === 0) {
    throw new Error("Unable to resolve user home directory");
  }
  return home;
};

const resolveUserPath = (rawPath: string): string => {
  const unquoted = stripMatchingQuotes(rawPath.trim());
  if (unquoted.length === 0) {
    throw new Error("Path is empty; provide a valid path");
  }
  if (unquoted === "~") {
    return resolveHomeDirectory();
  }
  if (unquoted.startsWith("~/") || unquoted.startsWith("~\\")) {
    return path.join(resolveHomeDirectory(), unquoted.slice(2));
  }
  return path.resolve(unquoted);
};

export const resolveMcpBridgeDiscoveryPath = (env: NodeJS.ProcessEnv = process.env): string => {
  const configuredDir = env[OPENDUCKTOR_CONFIG_DIR_ENV];
  const baseDir =
    configuredDir === undefined
      ? path.join(resolveHomeDirectory(), DEFAULT_CONFIG_DIR_NAME)
      : resolveUserPath(configuredDir);
  return path.join(baseDir, DISCOVERY_RELATIVE_PATH);
};

const parseDiscoveryFile = (payload: string, discoveryPath: string): McpBridgeDiscoveryFile => {
  const parsed = JSON.parse(payload) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid MCP bridge discovery file at ${discoveryPath}: expected object.`);
  }

  const record = parsed as Record<string, unknown>;
  if (typeof record.hostUrl !== "string" || record.hostUrl.trim().length === 0) {
    throw new Error(
      `Invalid MCP bridge discovery file at ${discoveryPath}: hostUrl must be a non-empty string.`,
    );
  }
  if (typeof record.hostToken !== "string" || record.hostToken.trim().length === 0) {
    throw new Error(
      `Invalid MCP bridge discovery file at ${discoveryPath}: hostToken must be a non-empty string.`,
    );
  }
  const pid = record.pid;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    throw new Error(
      `Invalid MCP bridge discovery file at ${discoveryPath}: pid must be a positive integer.`,
    );
  }

  return {
    hostToken: record.hostToken,
    hostUrl: record.hostUrl,
    pid,
  };
};

const discoveryRemovalTempPath = (discoveryPath: string): string =>
  path.join(
    path.dirname(discoveryPath),
    `.${path.basename(discoveryPath)}.${process.pid}.${process.hrtime.bigint()}.remove`,
  );

export const readMcpBridgeDiscoveryFile = async (
  discoveryPath: string,
): Promise<McpBridgeDiscoveryFile | null> => {
  try {
    return parseDiscoveryFile(await readFile(discoveryPath, "utf8"), discoveryPath);
  } catch (error) {
    if (isFsErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
};

export const writeMcpBridgeDiscoveryFile = async (
  discoveryPath: string,
  discovery: McpBridgeDiscoveryFile,
): Promise<void> => {
  await mkdir(path.dirname(discoveryPath), { recursive: true });
  const tempPath = path.join(
    path.dirname(discoveryPath),
    `.${path.basename(discoveryPath)}.${process.pid}.${process.hrtime.bigint()}.tmp`,
  );
  await writeFile(tempPath, `${JSON.stringify(discovery, null, 2)}\n`, { mode: 0o600 });
  await rename(tempPath, discoveryPath);
};

export const removeMcpBridgeDiscoveryFile = async (
  discoveryPath: string,
  discovery: McpBridgeDiscoveryFile,
): Promise<void> => {
  const tempPath = discoveryRemovalTempPath(discoveryPath);
  try {
    await rename(discoveryPath, tempPath);
  } catch (error) {
    if (isFsErrorCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }

  let current: McpBridgeDiscoveryFile;
  try {
    current = parseDiscoveryFile(await readFile(tempPath, "utf8"), tempPath);
  } catch (error) {
    await restoreClaimedDiscoveryFile(discoveryPath, tempPath);
    throw error;
  }

  if (
    current.hostUrl === discovery.hostUrl &&
    current.hostToken === discovery.hostToken &&
    current.pid === discovery.pid
  ) {
    await rm(tempPath, { force: true });
    return;
  }

  await restoreClaimedDiscoveryFile(discoveryPath, tempPath);
};

const restoreClaimedDiscoveryFile = async (
  discoveryPath: string,
  tempPath: string,
): Promise<void> => {
  try {
    await link(tempPath, discoveryPath);
  } catch (error) {
    if (!isFsErrorCode(error, "EEXIST")) {
      throw error;
    }
  } finally {
    await rm(tempPath, { force: true });
  }
};
