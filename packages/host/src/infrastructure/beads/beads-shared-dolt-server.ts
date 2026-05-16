import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import {
  processIsAlive,
  shouldStartDetachedProcessGroup,
  terminateProcessTree,
} from "../../adapters/process/process-tree";
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

    throw new Error(
      `Failed reading shared Dolt server state ${serverStatePath}: ${String(error)}`,
      {
        cause: error,
      },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw new Error(
      `Failed parsing shared Dolt server state ${serverStatePath}: ${String(error)}`,
      {
        cause: error,
      },
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Shared Dolt server state ${serverStatePath} must contain a JSON object`);
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
    throw new Error(
      `Shared Dolt server state ${serverStatePath} is missing pid, host, user, port, ownerPid, sharedServerRoot, doltDataDir, or startedAt`,
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
) => Promise<void>;

export const stopOwnedSharedDoltServer: StopSharedDoltServer = async (state, serverStatePath) => {
  if (state.ownerPid !== process.pid) {
    throw new Error(
      `Refusing to stop shared Dolt server ${state.pid}; it is owned by pid ${state.ownerPid}`,
    );
  }

  await terminateSharedDoltProcess(state.pid, `shared Dolt server ${state.pid}`);

  await unlink(serverStatePath).catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  });
};

export const pathExists = async (inputPath: string): Promise<boolean> => {
  try {
    await access(inputPath);
    return true;
  } catch {
    return false;
  }
};

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

export const runCommandAllowFailure: BeadsCommandRunner = async ({ command, args, cwd, env }) =>
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

export const portIsAvailable = async (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, SHARED_DOLT_SERVER_HOST, () => {
      server.close(() => resolve(true));
    });
  });

export const deterministicSharedDoltPortCandidate = async (baseDir: string): Promise<number> => {
  let resolvedBaseDir = path.isAbsolute(baseDir) ? baseDir : path.resolve(baseDir);
  try {
    resolvedBaseDir = await realpath(resolvedBaseDir);
  } catch {
    // The config dir may not exist yet; use its absolute spelling, matching Rust's canonical-or-absolute behavior.
  }
  const digest = createHash("sha256").update(resolvedBaseDir).digest();
  const offset = digest.readUInt16BE(0) % SHARED_DOLT_PORT_RANGE_LEN;
  return SHARED_DOLT_PORT_RANGE_START + offset;
};

export const wrapPortCandidate = (base: number, offset: number): number => {
  const normalizedBase = base - SHARED_DOLT_PORT_RANGE_START;
  return SHARED_DOLT_PORT_RANGE_START + ((normalizedBase + offset) % SHARED_DOLT_PORT_RANGE_LEN);
};

export const yamlQuotePath = (inputPath: string): string => `'${inputPath.replaceAll("'", "''")}'`;

export const writeDoltConfigFile = async (
  paths: BeadsSharedServerPaths,
  port: number,
): Promise<void> => {
  await mkdir(paths.sharedServerRoot, { recursive: true });
  await mkdir(paths.cfgDir, { recursive: true });
  const privilegeFile = path.join(paths.cfgDir, "privileges.db");
  const branchControlFile = path.join(paths.cfgDir, "branch_control.db");
  const config =
    `log_level: info\n` +
    `behavior:\n` +
    `  autocommit: true\n` +
    `listener:\n` +
    `  host: ${SHARED_DOLT_SERVER_HOST}\n` +
    `  port: ${port}\n` +
    `data_dir: ${yamlQuotePath(paths.doltRoot)}\n` +
    `cfg_dir: ${yamlQuotePath(paths.cfgDir)}\n` +
    `privilege_file: ${yamlQuotePath(privilegeFile)}\n` +
    `branch_control_file: ${yamlQuotePath(branchControlFile)}\n`;
  const tempFile = `${paths.doltConfigFile}.tmp-${process.pid}`;
  await writeFile(tempFile, config);
  await rename(tempFile, paths.doltConfigFile);
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
    throw new Error(
      `Failed starting shared Dolt server with config ${paths.doltConfigFile}: ${spawnError.message}`,
    );
  }

  if (await waitForServerReady(port, paths.env)) {
    if (!child.pid) {
      child.kill();
      throw new Error(`Shared Dolt server on port ${port} started without a process id`);
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
  throw new Error(
    cleanupErrors.length > 0
      ? `${startupError}\nCleanup failed: ${cleanupErrors.join("\n")}`
      : startupError,
  );
};

export const ensureSharedDoltServerRunning = (
  paths: BeadsSharedServerPaths,
  ensureSharedServer: EnsureSharedDoltServer,
): Promise<BeadsSharedServerState> => {
  const existing = sharedDoltServerFlights.get(paths.sharedServerRoot);
  if (existing) {
    return existing;
  }

  const flight = ensureSharedServer(paths).finally(() => {
    if (sharedDoltServerFlights.get(paths.sharedServerRoot) === flight) {
      sharedDoltServerFlights.delete(paths.sharedServerRoot);
    }
  });
  sharedDoltServerFlights.set(paths.sharedServerRoot, flight);
  return flight;
};

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

export const defaultEnsureSharedDoltServerRunning: EnsureSharedDoltServer = async (paths) => {
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
    throw new Error(
      `Shared Dolt server for ${paths.sharedServerRoot} is unhealthy but still owned by live pid ${existing.ownerPid}`,
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

  throw new Error(
    `Failed to start a shared Dolt server for ${paths.sharedServerRoot}; no available port in ${SHARED_DOLT_PORT_RANGE_START}-${SHARED_DOLT_PORT_RANGE_START + SHARED_DOLT_PORT_RANGE_LEN - 1}`,
  );
};
