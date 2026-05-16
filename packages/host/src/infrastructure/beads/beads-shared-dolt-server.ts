import { spawn } from "node:child_process";
import { access, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import { Effect, Fiber } from "effect";
import {
  processIsAlive,
  shouldStartDetachedProcessGroup,
  terminateProcessTree,
} from "../../adapters/process/process-tree";
import {
  HostOperationError,
  HostPathAccessError,
  HostResourceError,
  HostValidationError,
  toHostPathStatError,
} from "../../effect/host-errors";
import {
  type BeadsCommandRunner,
  type BeadsSharedServerPaths,
  type BeadsSharedServerState,
  type EnsureSharedDoltServer,
  MAX_DOLT_STARTUP_LOG_CHARS,
  SHARED_DOLT_HEALTH_POLL_INTERVAL_MS,
  SHARED_DOLT_HEALTH_TIMEOUT_MS,
  SHARED_DOLT_PORT_RANGE_LEN,
  SHARED_DOLT_PORT_RANGE_START,
  SHARED_DOLT_SERVER_HOST,
  SHARED_DOLT_SERVER_USER,
  SHARED_DOLT_TCP_TIMEOUT_MS,
  sharedDoltServerFlights,
} from "./beads-context-model";
import {
  deterministicSharedDoltPortCandidate,
  portIsAvailable,
  wrapPortCandidate,
  writeDoltConfigFile,
} from "./beads-shared-dolt-startup";

export { processIsAlive } from "../../adapters/process/process-tree";
export {
  deterministicSharedDoltPortCandidate,
  portIsAvailable,
  wrapPortCandidate,
  writeDoltConfigFile,
  yamlQuotePath,
} from "./beads-shared-dolt-startup";

const sharedDoltOperationError = (
  message: string,
  operation: string,
  cause?: unknown,
): HostOperationError => new HostOperationError({ message, operation, cause });

const sharedDoltResourceError = (
  message: string,
  operation: string,
  resource: string,
): HostResourceError => new HostResourceError({ message, operation, resource });

const sharedDoltValidationError = (
  message: string,
  field: string,
  cause?: unknown,
): HostValidationError => new HostValidationError({ message, field, cause });

export type SharedDoltServerError =
  | HostOperationError
  | HostPathAccessError
  | HostResourceError
  | HostValidationError;

const toSharedDoltServerError = (cause: unknown, operation: string): SharedDoltServerError => {
  if (
    cause instanceof HostOperationError ||
    cause instanceof HostPathAccessError ||
    cause instanceof HostResourceError ||
    cause instanceof HostValidationError
  ) {
    return cause;
  }

  return sharedDoltOperationError(String(cause), operation, cause);
};

export const readSharedServerState = async (
  serverStatePath: string,
): Promise<BeadsSharedServerState | null> => {
  let payload: string;
  try {
    payload = await readFile(serverStatePath, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw sharedDoltOperationError(
      `Failed reading shared Dolt server state ${serverStatePath}: ${String(error)}`,
      "shared-dolt.read-state",
      error,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw sharedDoltValidationError(
      `Failed parsing shared Dolt server state ${serverStatePath}: ${String(error)}`,
      "serverState",
      error,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw sharedDoltValidationError(
      `Shared Dolt server state ${serverStatePath} must contain a JSON object`,
      "serverState",
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
    throw sharedDoltValidationError(
      `Shared Dolt server state ${serverStatePath} is missing pid, host, user, port, ownerPid, sharedServerRoot, doltDataDir, or startedAt`,
      "serverState",
    );
  }

  return { pid, host, port, user, ownerPid, acquisition, sharedServerRoot, doltDataDir, startedAt };
};

export const waitForProcessExit = async (pid: number, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processIsAlive(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !processIsAlive(pid);
};

const terminateSharedDoltProcess = (
  pid: number,
  label: string,
  stopTimeoutMs = 2_000,
): Promise<void> =>
  terminateProcessTree({
    pid,
    label,
    isClosed: () => !processIsAlive(pid),
    waitForExit: (timeoutMs) => waitForProcessExit(pid, timeoutMs),
    stopTimeoutMs,
  });

export type StopSharedDoltServer = (
  state: BeadsSharedServerState,
  serverStatePath: string,
) => Effect.Effect<void, SharedDoltServerError>;

export const stopOwnedSharedDoltServer: StopSharedDoltServer = (state, serverStatePath) =>
  Effect.tryPromise({
    try: async () => {
      if (state.ownerPid !== process.pid) {
        throw sharedDoltValidationError(
          `Refusing to stop shared Dolt server ${state.pid}; it is owned by pid ${state.ownerPid}`,
          "ownerPid",
        );
      }

      await terminateSharedDoltProcess(state.pid, `shared Dolt server ${state.pid}`);

      await unlink(serverStatePath).catch((error: unknown) => {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return;
        }
        throw error;
      });
    },
    catch: (cause) => toSharedDoltServerError(cause, "shared-dolt.stop"),
  });

export const pathExists = (inputPath: string) =>
  Effect.tryPromise({
    try: () => access(inputPath),
    catch: (cause) => toHostPathStatError(cause, "shared-dolt.path-exists", inputPath),
  }).pipe(
    Effect.as(true),
    Effect.catchTag("HostPathNotFoundError", () => Effect.succeed(false)),
  );

export const tcpProbe = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.createConnection({ host: SHARED_DOLT_SERVER_HOST, port });
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(SHARED_DOLT_TCP_TIMEOUT_MS, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });

export const runDoltAllowFailure = async (
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<boolean> =>
  new Promise((resolve) => {
    const child = spawn("dolt", args, {
      env,
      stdio: ["ignore", "ignore", "ignore"],
    });
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });

export const runCommandAllowFailure: BeadsCommandRunner = ({ command, args, cwd, env }) =>
  Effect.tryPromise({
    try: () =>
      new Promise((resolve, reject) => {
        const child = spawn(command, args, {
          cwd,
          env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
        child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
        child.once("error", reject);
        child.once("close", (code) => {
          resolve({
            ok: code === 0,
            stdout: Buffer.concat(stdoutChunks).toString("utf8"),
            stderr: Buffer.concat(stderrChunks).toString("utf8"),
          });
        });
      }),
    catch: (cause) => toSharedDoltServerError(cause, "shared-dolt.run-command"),
  });

export const sqlProbe = (port: number, env: NodeJS.ProcessEnv): Promise<boolean> =>
  runDoltAllowFailure(
    [
      "--host",
      SHARED_DOLT_SERVER_HOST,
      "--port",
      String(port),
      "--no-tls",
      "-u",
      SHARED_DOLT_SERVER_USER,
      "-p",
      "",
      "sql",
      "-q",
      "show databases",
    ],
    env,
  );

export const serverStateIsHealthy = async (
  state: BeadsSharedServerState,
  paths: BeadsSharedServerPaths,
): Promise<boolean> => {
  if (state.host !== SHARED_DOLT_SERVER_HOST || state.user !== SHARED_DOLT_SERVER_USER) {
    return false;
  }
  if (state.sharedServerRoot !== paths.sharedServerRoot || state.doltDataDir !== paths.doltRoot) {
    return false;
  }
  if (!(await tcpProbe(state.port)) || !(await sqlProbe(state.port, paths.env))) {
    return false;
  }
  return processIsAlive(state.pid);
};

export const waitForServerReady = async (
  port: number,
  env: NodeJS.ProcessEnv,
): Promise<boolean> => {
  const deadline = Date.now() + SHARED_DOLT_HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await tcpProbe(port)) && (await sqlProbe(port, env))) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, SHARED_DOLT_HEALTH_POLL_INTERVAL_MS));
  }
  return false;
};

export const formatDoltStartupLog = (output: string): string => {
  const cleaned = output.replaceAll("\0", "").trim();
  if (cleaned.length <= MAX_DOLT_STARTUP_LOG_CHARS) {
    return cleaned;
  }
  return cleaned.slice(cleaned.length - MAX_DOLT_STARTUP_LOG_CHARS);
};

export const spawnSharedDoltServer = async (
  paths: BeadsSharedServerPaths,
  port: number,
): Promise<BeadsSharedServerState> => {
  const stdout = await open(path.join(paths.sharedServerRoot, "server.stdout.log"), "w");
  const stderrLogPath = path.join(paths.sharedServerRoot, "server.stderr.log");
  const stderr = await open(stderrLogPath, "w");
  const child = spawn("dolt", ["sql-server", "--config", paths.doltConfigFile], {
    cwd: paths.sharedServerRoot,
    detached: shouldStartDetachedProcessGroup(),
    env: paths.env,
    stdio: ["ignore", stdout.fd, stderr.fd],
  });

  const spawnError = await new Promise<Error | null>((resolve) => {
    child.once("error", resolve);
    child.once("spawn", () => resolve(null));
  });
  await Promise.all([stdout.close(), stderr.close()]);
  if (spawnError) {
    throw sharedDoltOperationError(
      `Failed starting shared Dolt server with config ${paths.doltConfigFile}: ${spawnError.message}`,
      "shared-dolt.start",
      spawnError,
    );
  }

  if (await waitForServerReady(port, paths.env)) {
    if (!child.pid) {
      child.kill();
      throw sharedDoltResourceError(
        `Shared Dolt server on port ${port} started without a process id`,
        "shared-dolt.start",
        "pid",
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
    try {
      await terminateSharedDoltProcess(childPid, `shared Dolt server on port ${port}`);
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error.message : String(error));
    }
  }
  const stderrOutput = await readFile(stderrLogPath, "utf8").catch(() => "");
  const detail = formatDoltStartupLog(stderrOutput);
  const startupError = detail
    ? `Shared Dolt server on port ${port} failed to become ready: ${detail}`
    : `Shared Dolt server on port ${port} failed to become ready within ${SHARED_DOLT_HEALTH_TIMEOUT_MS}ms`;
  throw sharedDoltOperationError(
    cleanupErrors.length > 0
      ? `${startupError}\nCleanup failed: ${cleanupErrors.join("\n")}`
      : startupError,
    "shared-dolt.wait-ready",
  );
};

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

export const writeSharedServerState = async (
  paths: BeadsSharedServerPaths,
  state: BeadsSharedServerState,
): Promise<void> => {
  await mkdir(path.dirname(paths.serverStatePath), { recursive: true });
  const tempFile = path.join(
    path.dirname(paths.serverStatePath),
    `.server.json.tmp-${process.pid}-${Date.now()}`,
  );
  await writeFile(tempFile, `${JSON.stringify(state, null, 2)}\n`);
  await rename(tempFile, paths.serverStatePath);
};

export const defaultEnsureSharedDoltServerRunning: EnsureSharedDoltServer = (paths) =>
  Effect.tryPromise({
    try: async () => {
      await mkdir(paths.sharedServerRoot, { recursive: true });
      await mkdir(paths.doltRoot, { recursive: true });
      await mkdir(paths.cfgDir, { recursive: true });

      const existing = await readSharedServerState(paths.serverStatePath);
      if (existing && (await serverStateIsHealthy(existing, paths))) {
        if (existing.ownerPid !== process.pid && !processIsAlive(existing.ownerPid)) {
          const adopted = {
            ...existing,
            ownerPid: process.pid,
            acquisition: "adopted_orphaned_server" as const,
          };
          await writeSharedServerState(paths, adopted);
          return adopted;
        }
        return existing;
      }

      if (existing && processIsAlive(existing.ownerPid) && existing.ownerPid !== process.pid) {
        throw sharedDoltValidationError(
          `Shared Dolt server for ${paths.sharedServerRoot} is unhealthy but still owned by live pid ${existing.ownerPid}`,
          "ownerPid",
        );
      }

      const basePort = await deterministicSharedDoltPortCandidate(paths.baseDir);
      for (let offset = 0; offset < SHARED_DOLT_PORT_RANGE_LEN; offset += 1) {
        const port = wrapPortCandidate(basePort, offset);
        if (!(await portIsAvailable(port))) {
          continue;
        }

        await writeDoltConfigFile(paths, port);
        try {
          const state = await spawnSharedDoltServer(paths, port);
          await writeSharedServerState(paths, state);
          return state;
        } catch (error) {
          const message =
            error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
          if (
            message.includes("address already in use") ||
            message.includes("bind") ||
            message.includes("listen tcp")
          ) {
            continue;
          }
          throw error;
        }
      }

      throw sharedDoltResourceError(
        `Failed to start a shared Dolt server for ${paths.sharedServerRoot}; no available port in ${SHARED_DOLT_PORT_RANGE_START}-${SHARED_DOLT_PORT_RANGE_START + SHARED_DOLT_PORT_RANGE_LEN - 1}`,
        "shared-dolt.start",
        paths.sharedServerRoot,
      );
    },
    catch: (cause) => toSharedDoltServerError(cause, "shared-dolt.ensure-default"),
  });
