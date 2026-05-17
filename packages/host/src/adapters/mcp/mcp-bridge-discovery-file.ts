import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";

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
    throw new HostValidationError({
      message: "Unable to resolve user home directory",
      field: "home",
    });
  }
  return home;
};

const resolveUserPath = (rawPath: string): string => {
  const unquoted = stripMatchingQuotes(rawPath.trim());
  if (unquoted.length === 0) {
    throw new HostValidationError({
      message: "Path is empty; provide a valid path",
      field: "path",
    });
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
    throw new HostValidationError({
      message: `Invalid MCP bridge discovery file at ${discoveryPath}: expected object.`,
      field: "discoveryFile",
      details: { discoveryPath },
    });
  }

  const record = parsed as Record<string, unknown>;
  if (typeof record.hostUrl !== "string" || record.hostUrl.trim().length === 0) {
    throw new HostValidationError({
      message: `Invalid MCP bridge discovery file at ${discoveryPath}: hostUrl must be a non-empty string.`,
      field: "hostUrl",
      details: { discoveryPath },
    });
  }
  if (typeof record.hostToken !== "string" || record.hostToken.trim().length === 0) {
    throw new HostValidationError({
      message: `Invalid MCP bridge discovery file at ${discoveryPath}: hostToken must be a non-empty string.`,
      field: "hostToken",
      details: { discoveryPath },
    });
  }
  const pid = record.pid;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    throw new HostValidationError({
      message: `Invalid MCP bridge discovery file at ${discoveryPath}: pid must be a positive integer.`,
      field: "pid",
      details: { discoveryPath },
    });
  }

  return {
    hostToken: record.hostToken,
    hostUrl: record.hostUrl,
    pid,
  };
};

const discoveryClaimPath = (discoveryPath: string): string =>
  path.join(
    path.dirname(discoveryPath),
    `.${path.basename(discoveryPath)}.${process.pid}.${process.hrtime.bigint()}.remove`,
  );

const discoveryMatches = (
  discovery: McpBridgeDiscoveryFile,
  expected: McpBridgeDiscoveryFile,
): boolean =>
  discovery.hostUrl === expected.hostUrl &&
  discovery.hostToken === expected.hostToken &&
  discovery.pid === expected.pid;

const claimDiscoveryForRemoval = (discoveryPath: string): Effect.Effect<string | null, unknown> => {
  const claimedPath = discoveryClaimPath(discoveryPath);
  return Effect.tryPromise({
    try: () => rename(discoveryPath, claimedPath),
    catch: (error) => error,
  }).pipe(
    Effect.as(claimedPath),
    Effect.catchAll((error) =>
      isFsErrorCode(error, "ENOENT") ? Effect.succeed(null) : Effect.fail(error),
    ),
  );
};

export const readMcpBridgeDiscoveryFile = (
  discoveryPath: string,
): Effect.Effect<McpBridgeDiscoveryFile | null, unknown> =>
  Effect.tryPromise({
    try: () => readFile(discoveryPath, "utf8"),
    catch: (error) => error,
  }).pipe(
    Effect.map((payload) => parseDiscoveryFile(payload, discoveryPath)),
    Effect.catchAll((error) =>
      isFsErrorCode(error, "ENOENT") ? Effect.succeed(null) : Effect.fail(error),
    ),
  );

export const writeMcpBridgeDiscoveryFile = (
  discoveryPath: string,
  discovery: McpBridgeDiscoveryFile,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise(() => mkdir(path.dirname(discoveryPath), { recursive: true }));
    const tempPath = path.join(
      path.dirname(discoveryPath),
      `.${path.basename(discoveryPath)}.${process.pid}.${process.hrtime.bigint()}.tmp`,
    );
    yield* Effect.tryPromise(() =>
      writeFile(tempPath, `${JSON.stringify(discovery, null, 2)}\n`, { mode: 0o600 }),
    );
    yield* Effect.tryPromise(() => rename(tempPath, discoveryPath));
  });

export const removeMcpBridgeDiscoveryFile = (
  discoveryPath: string,
  discovery: McpBridgeDiscoveryFile,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const claimedPath = yield* claimDiscoveryForRemoval(discoveryPath);
    if (claimedPath === null) {
      return;
    }

    const current = yield* Effect.tryPromise({
      try: () => readFile(claimedPath, "utf8"),
      catch: (error) => error,
    }).pipe(
      Effect.map((payload) => parseDiscoveryFile(payload, claimedPath)),
      Effect.tapError(() => restoreClaimedDiscoveryUnlessReplaced(discoveryPath, claimedPath)),
    );

    if (discoveryMatches(current, discovery)) {
      yield* Effect.tryPromise(() => rm(claimedPath, { force: true }));
      return;
    }

    yield* restoreClaimedDiscoveryUnlessReplaced(discoveryPath, claimedPath);
  });

const restoreClaimedDiscoveryUnlessReplaced = (
  discoveryPath: string,
  claimedPath: string,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const restore = Effect.tryPromise({
      try: () => link(claimedPath, discoveryPath),
      catch: (error) => error,
    }).pipe(
      Effect.catchAll((error) =>
        isFsErrorCode(error, "EEXIST") ? Effect.void : Effect.fail(error),
      ),
    );
    const restoreExit = yield* Effect.exit(restore);
    yield* Effect.tryPromise(() => rm(claimedPath, { force: true }));
    if (restoreExit._tag === "Failure") {
      return yield* Effect.failCause(restoreExit.cause);
    }
  });
