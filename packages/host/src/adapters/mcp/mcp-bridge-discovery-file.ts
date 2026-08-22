import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  MCP_BRIDGE_PRODUCTION_DISCOVERY_PATH_SEGMENTS,
  mcpBridgeDevelopmentDiscoveryPathSegments,
  hasRuntimeType,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { resolveDevelopmentInstanceIdFromEnvironment } from "../../config/development-instance";
import { resolveOpenDucktorBaseDir } from "../../config/openducktor-config-dir";
import { HostValidationError } from "../../effect/host-errors";
import { parseJson } from "../../effect/json";
import type { JsonValue } from "@openducktor/contracts";

export type McpBridgeDiscoveryMode = "development" | "production";

export type McpBridgeDiscoveryFile = {
  hostToken: string;
  hostUrl: string;
  pid: number;
};

const isFsErrorCode = (cause: unknown, code: string): boolean =>
  hasRuntimeType(cause, "object") && cause !== null && "code" in cause && cause.code === code;

export const resolveMcpBridgeDiscoveryPath = (
  mode: McpBridgeDiscoveryMode,
  env: NodeJS.ProcessEnv = process.env,
): string => {
  const baseDirectory = resolveOpenDucktorBaseDir(env);
  if (mode === "production") {
    return path.resolve(baseDirectory, ...MCP_BRIDGE_PRODUCTION_DISCOVERY_PATH_SEGMENTS);
  }
  const developmentInstanceId = resolveDevelopmentInstanceIdFromEnvironment(env);
  return path.resolve(
    baseDirectory,
    ...mcpBridgeDevelopmentDiscoveryPathSegments(developmentInstanceId),
  );
};

const parseDiscoveryFile = (payload: string, discoveryPath: string): McpBridgeDiscoveryFile => {
  const parsed = parseJson(payload);
  if (parsed === null || !hasRuntimeType(parsed, "object") || Array.isArray(parsed)) {
    throw new HostValidationError({
      message: `Invalid MCP bridge discovery file at ${discoveryPath}: expected object.`,
      field: "discoveryFile",
      details: { discoveryPath },
    });
  }

  // SAFETY: The preceding runtime guard establishes `Record<string, JsonValue>` before this assertion.
  const record = parsed as Record<string, JsonValue>;
  if (!hasRuntimeType(record.hostUrl, "string") || record.hostUrl.trim().length === 0) {
    throw new HostValidationError({
      message: `Invalid MCP bridge discovery file at ${discoveryPath}: hostUrl must be a non-empty string.`,
      field: "hostUrl",
      details: { discoveryPath },
    });
  }
  if (!hasRuntimeType(record.hostToken, "string") || record.hostToken.trim().length === 0) {
    throw new HostValidationError({
      message: `Invalid MCP bridge discovery file at ${discoveryPath}: hostToken must be a non-empty string.`,
      field: "hostToken",
      details: { discoveryPath },
    });
  }
  const pid = record.pid;
  if (!hasRuntimeType(pid, "number") || !Number.isInteger(pid) || pid <= 0) {
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
      Effect.map((payload) => parseDiscoveryFile(payload, discoveryPath)),
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
