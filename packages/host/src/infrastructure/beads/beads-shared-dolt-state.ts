import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Clock, Effect } from "effect";
import { HostResourceError } from "../../effect/host-errors";
import { parseJson } from "../../effect/json";
import type { BeadsSharedServerPaths, BeadsSharedServerState } from "./beads-context-model";
import {
  type SharedDoltServerError,
  sharedDoltOperationError,
  sharedDoltValidationError,
  toSharedDoltServerError,
} from "./beads-shared-dolt-errors";

export const readSharedServerState = (
  serverStatePath: string,
): Effect.Effect<BeadsSharedServerState | null, SharedDoltServerError> =>
  Effect.gen(function* () {
    const payload = yield* Effect.tryPromise({
      try: () => readFile(serverStatePath, "utf8"),
      catch: (error) => {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return new HostResourceError({
            message: `Shared Dolt server state ${serverStatePath} does not exist`,
            operation: "shared-dolt.read-state",
            resource: serverStatePath,
          });
        }
        return sharedDoltOperationError(
          `Failed reading shared Dolt server state ${serverStatePath}: ${String(error)}`,
          "shared-dolt.read-state",
          error,
        );
      },
    }).pipe(Effect.catchTag("HostResourceError", () => Effect.succeed(null)));

    if (payload === null) {
      return null;
    }

    const parsed = yield* Effect.try({
      try: () => parseJson(payload),
      catch: (error) =>
        sharedDoltValidationError(
          `Failed parsing shared Dolt server state ${serverStatePath}: ${String(error)}`,
          "serverState",
          error,
        ),
    });

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return yield* Effect.fail(
        sharedDoltValidationError(
          `Shared Dolt server state ${serverStatePath} must contain a JSON object`,
          "serverState",
        ),
      );
    }

    const record = parsed as Record<string, unknown>;
    const host = typeof record.host === "string" ? record.host.trim() : "";
    const user = typeof record.user === "string" ? record.user.trim() : "";
    const pid = typeof record.pid === "number" && Number.isInteger(record.pid) ? record.pid : null;
    const port =
      typeof record.port === "number" && Number.isInteger(record.port) ? record.port : null;
    const ownerPid =
      typeof record.ownerPid === "number" && Number.isInteger(record.ownerPid)
        ? record.ownerPid
        : null;
    const acquisition =
      record.acquisition === "adopted_orphaned_server"
        ? "adopted_orphaned_server"
        : "started_by_owner";
    const sharedServerRoot =
      typeof record.sharedServerRoot === "string" ? record.sharedServerRoot.trim() : "";
    const doltDataDir = typeof record.doltDataDir === "string" ? record.doltDataDir.trim() : "";
    const startedAt = typeof record.startedAt === "string" ? record.startedAt.trim() : "";

    if (
      pid === null ||
      pid <= 0 ||
      !host ||
      !user ||
      port === null ||
      port <= 0 ||
      ownerPid === null ||
      ownerPid <= 0 ||
      !sharedServerRoot ||
      !doltDataDir ||
      !startedAt
    ) {
      return yield* Effect.fail(
        sharedDoltValidationError(
          `Shared Dolt server state ${serverStatePath} is missing pid, host, user, port, ownerPid, sharedServerRoot, doltDataDir, or startedAt`,
          "serverState",
        ),
      );
    }

    return {
      pid,
      host,
      port,
      user,
      ownerPid,
      acquisition,
      sharedServerRoot,
      doltDataDir,
      startedAt,
    };
  });

export const writeSharedServerState = (
  paths: BeadsSharedServerPaths,
  state: BeadsSharedServerState,
): Effect.Effect<void, SharedDoltServerError> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => mkdir(path.dirname(paths.serverStatePath), { recursive: true }),
      catch: (cause) => toSharedDoltServerError(cause, "shared-dolt.ensure-state-dir"),
    });
    const now = yield* Clock.currentTimeMillis;
    const tempFile = path.join(
      path.dirname(paths.serverStatePath),
      `.server.json.tmp-${process.pid}-${now}`,
    );
    yield* Effect.tryPromise({
      try: () => writeFile(tempFile, `${JSON.stringify(state, null, 2)}\n`),
      catch: (cause) => toSharedDoltServerError(cause, "shared-dolt.write-state-temp"),
    });
    yield* Effect.tryPromise({
      try: () => rename(tempFile, paths.serverStatePath),
      catch: (cause) => toSharedDoltServerError(cause, "shared-dolt.rename-state"),
    });
  });
