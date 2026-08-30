import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  MCP_BRIDGE_PRODUCTION_DISCOVERY_PATH_SEGMENTS,
  type McpBridgeDiscoveryFile,
  mcpBridgeDiscoveryFileSchema,
  mcpBridgeDevelopmentDiscoveryPathSegments,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { z } from "zod";
import { resolveDevelopmentInstanceIdFromEnvironment } from "../../config/development-instance";
import { resolveOpenDucktorBaseDir } from "../../config/openducktor-config-dir";
import {
  type HostOperationErrorAggregate,
  HostValidationError,
  type HostValidationErrorAggregate,
  toHostOperationError,
} from "../../effect/host-errors";
import { parseJson } from "../../effect/json";

export type McpBridgeDiscoveryMode = "development" | "production";

export type { McpBridgeDiscoveryFile } from "@openducktor/contracts";

const fsErrorSchema = z.object({ code: z.string() }).passthrough();
const isFsErrorCode = (cause: unknown, code: string): boolean => {
  const parsed = fsErrorSchema.safeParse(cause);
  return parsed.success && parsed.data.code === code;
};

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
  const result = mcpBridgeDiscoveryFileSchema.safeParse(parsed);
  if (result.success) {
    return result.data;
  }

  const field = result.error.issues[0]?.path[0];
  if (field === "hostUrl") {
    throw new HostValidationError({
      message: `Invalid MCP bridge discovery file at ${discoveryPath}: hostUrl must be a non-empty string.`,
      field: "hostUrl",
      details: { discoveryPath },
    });
  }
  if (field === "hostToken") {
    throw new HostValidationError({
      message: `Invalid MCP bridge discovery file at ${discoveryPath}: hostToken must be a non-empty string.`,
      field: "hostToken",
      details: { discoveryPath },
    });
  }
  if (field === "pid") {
    throw new HostValidationError({
      message: `Invalid MCP bridge discovery file at ${discoveryPath}: pid must be a positive integer.`,
      field: "pid",
      details: { discoveryPath },
    });
  }

  throw new HostValidationError({
    message: `Invalid MCP bridge discovery file at ${discoveryPath}: expected object.`,
    field: "discoveryFile",
    details: { discoveryPath },
  });
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

const discoveryFileOperation = <Value>(
  operation: string,
  discoveryPath: string,
  run: () => Promise<Value>,
): Effect.Effect<Value, HostOperationErrorAggregate> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => toHostOperationError(cause, operation, { discoveryPath }),
  });

const claimDiscoveryForRemoval = (
  discoveryPath: string,
): Effect.Effect<string | null, HostOperationErrorAggregate> => {
  const claimedPath = discoveryClaimPath(discoveryPath);
  return discoveryFileOperation("mcpBridgeDiscovery.claim", discoveryPath, async () => {
    try {
      await rename(discoveryPath, claimedPath);
      return claimedPath;
    } catch (cause) {
      if (isFsErrorCode(cause, "ENOENT")) {
        return null;
      }
      throw cause;
    }
  });
};
export const writeMcpBridgeDiscoveryFile = (
  discoveryPath: string,
  discovery: McpBridgeDiscoveryFile,
): Effect.Effect<void, HostOperationErrorAggregate> =>
  Effect.gen(function* () {
    yield* discoveryFileOperation("mcpBridgeDiscovery.mkdir", discoveryPath, () =>
      mkdir(path.dirname(discoveryPath), { recursive: true }),
    );
    const tempPath = path.join(
      path.dirname(discoveryPath),
      `.${path.basename(discoveryPath)}.${process.pid}.${process.hrtime.bigint()}.tmp`,
    );
    yield* discoveryFileOperation("mcpBridgeDiscovery.write", discoveryPath, () =>
      writeFile(tempPath, `${JSON.stringify(discovery, null, 2)}\n`, { mode: 0o600 }),
    );
    yield* discoveryFileOperation("mcpBridgeDiscovery.publish", discoveryPath, () =>
      rename(tempPath, discoveryPath),
    );
  });

export const removeMcpBridgeDiscoveryFile = (
  discoveryPath: string,
  discovery: McpBridgeDiscoveryFile,
): Effect.Effect<void, HostOperationErrorAggregate | HostValidationErrorAggregate> =>
  Effect.gen(function* () {
    const claimedPath = yield* claimDiscoveryForRemoval(discoveryPath);
    if (claimedPath === null) {
      return;
    }

    const current = yield* Effect.gen(function* () {
      const payload = yield* discoveryFileOperation(
        "mcpBridgeDiscovery.readClaim",
        discoveryPath,
        () => readFile(claimedPath, "utf8"),
      );
      return yield* Effect.try({
        try: () => parseDiscoveryFile(payload, discoveryPath),
        catch: (cause) =>
          cause instanceof HostValidationError
            ? cause
            : toHostOperationError(cause, "mcpBridgeDiscovery.parse", { discoveryPath }),
      });
    }).pipe(
      Effect.tapError(() => restoreClaimedDiscoveryUnlessReplaced(discoveryPath, claimedPath)),
    );

    if (discoveryMatches(current, discovery)) {
      yield* discoveryFileOperation("mcpBridgeDiscovery.removeClaim", discoveryPath, () =>
        rm(claimedPath, { force: true }),
      );
      return;
    }

    yield* restoreClaimedDiscoveryUnlessReplaced(discoveryPath, claimedPath);
  });

const restoreClaimedDiscoveryUnlessReplaced = (
  discoveryPath: string,
  claimedPath: string,
): Effect.Effect<void, HostOperationErrorAggregate> =>
  Effect.gen(function* () {
    const restore = discoveryFileOperation(
      "mcpBridgeDiscovery.restore",
      discoveryPath,
      async () => {
        try {
          await link(claimedPath, discoveryPath);
        } catch (cause) {
          if (!isFsErrorCode(cause, "EEXIST")) {
            throw cause;
          }
        }
      },
    );
    const restoreExit = yield* Effect.exit(restore);
    yield* discoveryFileOperation("mcpBridgeDiscovery.removeClaim", discoveryPath, () =>
      rm(claimedPath, { force: true }),
    );
    if (restoreExit._tag === "Failure") {
      return yield* Effect.failCause(restoreExit.cause);
    }
  });
