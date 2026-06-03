import { spawn } from "node:child_process";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";

import { Clock, Effect, Fiber } from "effect";
import { HostResourceError } from "../../effect/host-errors";
import { createProcessCommandLaunch } from "../process/process-command-launch";
import {
  processIsAlive,
  shouldStartDetachedProcessGroup,
  terminateProcessTree,
} from "../process/process-tree";
import {
  type BeadsSharedServerPaths,
  type BeadsSharedServerState,
  type EnsureSharedDoltServer,
  SHARED_DOLT_HEALTH_TIMEOUT_MS,
  SHARED_DOLT_PORT_RANGE_LEN,
  SHARED_DOLT_PORT_RANGE_START,
  SHARED_DOLT_SERVER_HOST,
  SHARED_DOLT_SERVER_USER,
  sharedDoltServerFlights,
} from "./beads-context-model";
import {
  type SharedDoltServerError,
  sharedDoltOperationError,
  sharedDoltResourceError,
  sharedDoltValidationError,
  toSharedDoltServerError,
} from "./beads-shared-dolt-errors";
import {
  formatDoltStartupLog,
  serverStateIsHealthy,
  waitForServerReady,
} from "./beads-shared-dolt-health";
import {
  deterministicSharedDoltPortCandidate,
  portIsAvailable,
  wrapPortCandidate,
  writeDoltConfigFile,
} from "./beads-shared-dolt-startup";
import { readSharedServerState, writeSharedServerState } from "./beads-shared-dolt-state";

export type { SharedDoltServerError } from "./beads-shared-dolt-errors";
export { pathExists, runCommandAllowFailure } from "./beads-shared-dolt-health";
export { readSharedServerState } from "./beads-shared-dolt-state";

const waitForProcessExit = (pid: number, timeoutMs: number): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis;
    const deadline = startedAt + timeoutMs;
    while ((yield* Clock.currentTimeMillis) < deadline) {
      if (!processIsAlive(pid)) {
        return true;
      }
      yield* Effect.sleep("100 millis");
    }
    return !processIsAlive(pid);
  });

const terminateSharedDoltProcess = (
  pid: number,
  label: string,
  stopTimeoutMs = 2_000,
): Effect.Effect<void, SharedDoltServerError> =>
  terminateProcessTree({
    pid,
    label,
    isClosed: () => !processIsAlive(pid),
    waitForExit: (timeoutMs) => waitForProcessExit(pid, timeoutMs),
    stopTimeoutMs,
  }).pipe(
    Effect.mapError((cause) => toSharedDoltServerError(cause, "shared-dolt.terminate-process")),
  );

export type StopSharedDoltServer = (
  state: BeadsSharedServerState,
  serverStatePath: string,
) => Effect.Effect<void, SharedDoltServerError>;

export const stopOwnedSharedDoltServer: StopSharedDoltServer = (state, serverStatePath) =>
  Effect.gen(function* () {
    if (state.ownerPid !== process.pid) {
      return yield* Effect.fail(
        sharedDoltValidationError(
          `Refusing to stop shared Dolt server ${state.pid}; it is owned by pid ${state.ownerPid}`,
          "ownerPid",
        ),
      );
    }

    yield* terminateSharedDoltProcess(state.pid, `shared Dolt server ${state.pid}`);

    yield* Effect.tryPromise({
      try: () => unlink(serverStatePath),
      catch: (error) => {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return new HostResourceError({
            message: `Shared Dolt server state ${serverStatePath} does not exist`,
            operation: "shared-dolt.unlink-state",
            resource: serverStatePath,
          });
        }
        return toSharedDoltServerError(error, "shared-dolt.unlink-state");
      },
    }).pipe(Effect.catchTag("HostResourceError", () => Effect.void));
  });

const spawnSharedDoltServer = (
  paths: BeadsSharedServerPaths,
  port: number,
): Effect.Effect<BeadsSharedServerState, SharedDoltServerError> =>
  Effect.scoped(
    Effect.gen(function* () {
      const stdout = yield* Effect.tryPromise({
        try: () => open(path.join(paths.sharedServerRoot, "server.stdout.log"), "w"),
        catch: (cause) => toSharedDoltServerError(cause, "shared-dolt.open-stdout"),
      });
      yield* Effect.addFinalizer(() =>
        Effect.tryPromise({
          try: () => stdout.close(),
          catch: (cause) => toSharedDoltServerError(cause, "shared-dolt.close-stdout"),
        }).pipe(Effect.catchAll(() => Effect.void)),
      );
      const stderrLogPath = path.join(paths.sharedServerRoot, "server.stderr.log");
      const stderr = yield* Effect.tryPromise({
        try: () => open(stderrLogPath, "w"),
        catch: (cause) => toSharedDoltServerError(cause, "shared-dolt.open-stderr"),
      });
      yield* Effect.addFinalizer(() =>
        Effect.tryPromise({
          try: () => stderr.close(),
          catch: (cause) => toSharedDoltServerError(cause, "shared-dolt.close-stderr"),
        }).pipe(Effect.catchAll(() => Effect.void)),
      );
      const child = yield* Effect.try({
        try: () => {
          const launch = createProcessCommandLaunch(
            paths.tools.dolt,
            ["sql-server", "--config", paths.doltConfigFile],
            paths.env,
            process.platform,
          );
          return spawn(launch.command, launch.args, {
            cwd: paths.sharedServerRoot,
            detached: shouldStartDetachedProcessGroup(),
            env: launch.env,
            stdio: ["ignore", stdout.fd, stderr.fd],
            windowsVerbatimArguments: launch.windowsVerbatimArguments,
          });
        },
        catch: (cause) => toSharedDoltServerError(cause, "shared-dolt.spawn"),
      });

      const spawnError = yield* Effect.async<Error | null>((resume, signal) => {
        let settled = false;
        const finish = (error: Error | null): void => {
          if (settled) {
            return;
          }
          settled = true;
          signal.removeEventListener("abort", abort);
          child.off("error", onError);
          child.off("spawn", onSpawn);
          resume(Effect.succeed(error));
        };
        const abort = (): void => {
          child.kill("SIGTERM");
          finish(new Error("Shared Dolt server spawn was aborted."));
        };
        const onError = (error: Error) => finish(error);
        const onSpawn = () => finish(null);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) {
          abort();
          return;
        }
        child.once("error", onError);
        child.once("spawn", onSpawn);
      });
      yield* Effect.all(
        [
          Effect.tryPromise({
            try: () => stdout.close(),
            catch: (cause) => toSharedDoltServerError(cause, "shared-dolt.close-stdout"),
          }),
          Effect.tryPromise({
            try: () => stderr.close(),
            catch: (cause) => toSharedDoltServerError(cause, "shared-dolt.close-stderr"),
          }),
        ],
        { discard: true },
      );
      if (spawnError) {
        return yield* Effect.fail(
          sharedDoltOperationError(
            `Failed starting shared Dolt server with config ${paths.doltConfigFile}: ${spawnError.message}`,
            "shared-dolt.start",
            spawnError,
          ),
        );
      }

      if (yield* waitForServerReady(port, paths.env, paths.tools.dolt)) {
        if (!child.pid) {
          child.kill();
          return yield* Effect.fail(
            sharedDoltResourceError(
              `Shared Dolt server on port ${port} started without a process id`,
              "shared-dolt.start",
              "pid",
            ),
          );
        }
        child.unref();
        return {
          pid: child.pid,
          ownerPid: process.pid,
          acquisition: "started_by_owner",
          host: SHARED_DOLT_SERVER_HOST,
          user: SHARED_DOLT_SERVER_USER,
          port,
          sharedServerRoot: paths.sharedServerRoot,
          doltDataDir: paths.doltRoot,
          startedAt: new Date().toISOString(),
        };
      }

      const cleanupErrors: string[] = [];
      const childPid = child.pid;
      if (childPid && childPid > 0) {
        const cleanupExit = yield* Effect.either(
          terminateSharedDoltProcess(childPid, `shared Dolt server on port ${port}`),
        );
        if (cleanupExit._tag === "Left") {
          cleanupErrors.push(cleanupExit.left.message);
        }
      }
      const stderrOutput = yield* Effect.tryPromise({
        try: () => readFile(stderrLogPath, "utf8"),
        catch: (cause) => toSharedDoltServerError(cause, "shared-dolt.read-stderr"),
      }).pipe(Effect.catchAll(() => Effect.succeed("")));
      const detail = formatDoltStartupLog(stderrOutput);
      const startupError = detail
        ? `Shared Dolt server on port ${port} failed to become ready: ${detail}`
        : `Shared Dolt server on port ${port} failed to become ready within ${SHARED_DOLT_HEALTH_TIMEOUT_MS}ms`;
      return yield* Effect.fail(
        sharedDoltOperationError(
          cleanupErrors.length > 0
            ? `${startupError}\nCleanup failed: ${cleanupErrors.join("\n")}`
            : startupError,
          "shared-dolt.wait-ready",
        ),
      );
    }),
  );

export const ensureSharedDoltServerRunning = (
  paths: BeadsSharedServerPaths,
  ensureSharedServer: EnsureSharedDoltServer,
) =>
  Effect.gen(function* () {
    const existing = sharedDoltServerFlights.get(paths.sharedServerRoot);
    if (existing) {
      return yield* Fiber.join(existing);
    }

    const flight = yield* Effect.forkDaemon(ensureSharedServer(paths));
    sharedDoltServerFlights.set(paths.sharedServerRoot, flight);
    return yield* Fiber.join(flight).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (sharedDoltServerFlights.get(paths.sharedServerRoot) === flight) {
            sharedDoltServerFlights.delete(paths.sharedServerRoot);
          }
        }),
      ),
    );
  });

export const defaultEnsureSharedDoltServerRunning: EnsureSharedDoltServer = (paths) =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => mkdir(paths.sharedServerRoot, { recursive: true }),
      catch: (cause) => toSharedDoltServerError(cause, "shared-dolt.ensure-root"),
    });
    yield* Effect.tryPromise({
      try: () => mkdir(paths.doltRoot, { recursive: true }),
      catch: (cause) => toSharedDoltServerError(cause, "shared-dolt.ensure-data-dir"),
    });
    yield* Effect.tryPromise({
      try: () => mkdir(paths.cfgDir, { recursive: true }),
      catch: (cause) => toSharedDoltServerError(cause, "shared-dolt.ensure-cfg-dir"),
    });

    const existing = yield* readSharedServerState(paths.serverStatePath);
    const existingHealthy = existing ? yield* serverStateIsHealthy(existing, paths) : false;
    if (existing && existingHealthy) {
      if (existing.ownerPid !== process.pid && !processIsAlive(existing.ownerPid)) {
        const adopted = {
          ...existing,
          ownerPid: process.pid,
          acquisition: "adopted_orphaned_server" as const,
        };
        yield* writeSharedServerState(paths, adopted);
        return adopted;
      }
      return existing;
    }

    if (existing && processIsAlive(existing.ownerPid) && existing.ownerPid !== process.pid) {
      return yield* Effect.fail(
        sharedDoltValidationError(
          `Shared Dolt server for ${paths.sharedServerRoot} is unhealthy but still owned by live pid ${existing.ownerPid}`,
          "ownerPid",
        ),
      );
    }

    const basePort = yield* deterministicSharedDoltPortCandidate(paths.baseDir).pipe(
      Effect.mapError((cause) => toSharedDoltServerError(cause, "shared-dolt.port-candidate")),
    );
    for (let offset = 0; offset < SHARED_DOLT_PORT_RANGE_LEN; offset += 1) {
      const port = wrapPortCandidate(basePort, offset);
      const available = yield* portIsAvailable(port);
      if (!available) {
        continue;
      }

      yield* writeDoltConfigFile(paths, port).pipe(
        Effect.mapError((cause) => toSharedDoltServerError(cause, "shared-dolt.write-config")),
      );
      const started = yield* Effect.either(spawnSharedDoltServer(paths, port));
      if (started._tag === "Left") {
        const message = started.left.message.toLowerCase();
        if (
          message.includes("address already in use") ||
          message.includes("bind") ||
          message.includes("listen tcp")
        ) {
          continue;
        }
        return yield* Effect.fail(started.left);
      }
      yield* writeSharedServerState(paths, started.right);
      return started.right;
    }

    return yield* Effect.fail(
      sharedDoltResourceError(
        `Failed to start a shared Dolt server for ${paths.sharedServerRoot}; no available port in ${SHARED_DOLT_PORT_RANGE_START}-${SHARED_DOLT_PORT_RANGE_START + SHARED_DOLT_PORT_RANGE_LEN - 1}`,
        "shared-dolt.start",
        paths.sharedServerRoot,
      ),
    );
  });
