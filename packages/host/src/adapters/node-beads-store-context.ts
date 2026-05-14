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
import { homedir } from "node:os";
import path from "node:path";
import type { RepoStoreHealth } from "@openducktor/contracts";

const OPENDUCKTOR_CONFIG_DIR_ENV = "OPENDUCKTOR_CONFIG_DIR";
const DEFAULT_CONFIG_DIR_NAME = ".openducktor";
const SHARED_DOLT_SERVER_HOST = "127.0.0.1";
const SHARED_DOLT_SERVER_USER = "root";
const SHARED_DOLT_PORT_RANGE_START = 36_000;
const SHARED_DOLT_PORT_RANGE_LEN = 10_000;
const SHARED_DOLT_HEALTH_TIMEOUT_MS = 5_000;
const SHARED_DOLT_HEALTH_POLL_INTERVAL_MS = 100;
const SHARED_DOLT_TCP_TIMEOUT_MS = 250;
const CUSTOM_STATUS_VALUES = "spec_ready,ready_for_dev,ai_review,human_review";
const MAX_DOLT_STARTUP_LOG_CHARS = 4_000;

export type BeadsSharedServerState = {
  pid: number;
  host: string;
  port: number;
  user: string;
  ownerPid: number;
  acquisition: "started_by_owner" | "adopted_orphaned_server";
  sharedServerRoot: string;
  doltDataDir: string;
  startedAt: string;
};

export type BeadsSharedServerPaths = {
  baseDir: string;
  beadsRoot: string;
  sharedServerRoot: string;
  doltRoot: string;
  cfgDir: string;
  doltConfigFile: string;
  env: NodeJS.ProcessEnv;
  serverStatePath: string;
};

export type BeadsCliContext = {
  repoPath: string;
  repoId: string;
  databaseName: string;
  attachmentRoot: string;
  beadsDir: string;
  workingDir: string;
  serverStatePath: string;
  sharedServer: BeadsSharedServerState | null;
  env: NodeJS.ProcessEnv;
};

export type EnsureSharedDoltServer = (
  paths: BeadsSharedServerPaths,
) => Promise<BeadsSharedServerState>;

export type EnsureBeadsAttachment = (context: BeadsCliContext) => Promise<void>;

export type BeadsCommandRunner = (input: {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}) => Promise<{ ok: boolean; stdout: string; stderr: string }>;

export type ResolveBeadsCliContextOptions = {
  requireSharedServer?: boolean;
  ensureSharedServer?: EnsureSharedDoltServer;
  ensureAttachment?: EnsureBeadsAttachment;
  processEnv?: NodeJS.ProcessEnv;
  workspaceId?: string | null;
};

type BeadsAttachmentMetadata = {
  backend?: unknown;
  dolt_mode?: unknown;
  dolt_server_host?: unknown;
  dolt_server_port?: unknown;
  dolt_server_user?: unknown;
  dolt_database?: unknown;
};

const sharedDoltServerFlights = new Map<string, Promise<BeadsSharedServerState>>();

type BeadsWherePayload = {
  path?: unknown;
  error?: unknown;
};

type BeadsReadiness =
  | { type: "ready" }
  | { type: "missing_attachment" }
  | { type: "missing_shared_database" }
  | { type: "attachment_verification_failed"; reason: string };

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

const resolveHomeDirectory = (): string => {
  const home = homedir();
  if (home.trim().length > 0) {
    return home;
  }

  throw new Error("Unable to resolve user home directory");
};

const resolveUserPath = (rawPath: string): string => {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    throw new Error("Path is empty; provide a valid path");
  }

  const unquoted = stripMatchingQuotes(trimmed);
  if (!unquoted) {
    throw new Error("Path is empty; provide a valid path");
  }

  if (unquoted === "~") {
    return resolveHomeDirectory();
  }

  const homeRelativePrefix = unquoted.startsWith("~/")
    ? "~/"
    : unquoted.startsWith("~\\")
      ? "~\\"
      : null;

  if (!homeRelativePrefix) {
    return unquoted;
  }

  return path.join(resolveHomeDirectory(), unquoted.slice(homeRelativePrefix.length));
};

const resolveOpenDucktorBaseDir = (env: NodeJS.ProcessEnv = process.env): string => {
  const envDir = env[OPENDUCKTOR_CONFIG_DIR_ENV];
  if (envDir !== undefined) {
    if (envDir.length === 0) {
      throw new Error("OPENDUCKTOR_CONFIG_DIR is set but empty; provide a valid directory path");
    }

    return resolveUserPath(envDir);
  }

  return path.join(resolveHomeDirectory(), DEFAULT_CONFIG_DIR_NAME);
};

const sanitizeSlug = (input: string): string => {
  let slug = "";
  let lastDash = false;

  for (const character of input) {
    const lower = character.toLowerCase();
    if (/^[a-z0-9]$/.test(lower)) {
      slug += lower;
      lastDash = false;
      continue;
    }

    if (!lastDash) {
      slug += "-";
      lastDash = true;
    }
  }

  const trimmed = slug.replace(/^-+|-+$/g, "");
  return trimmed.length > 0 ? trimmed : "repo";
};

const sanitizeDatabaseIdentifier = (input: string): string => {
  const sanitized = Array.from(input)
    .map((character) => (/^[a-z0-9]$/i.test(character) ? character.toLowerCase() : "_"))
    .join("");
  const trimmed = sanitized.replace(/^_+|_+$/g, "");
  return trimmed.length > 0 ? trimmed : "repo";
};

const canonicalOrAbsolute = async (repoPath: string): Promise<string> => {
  const absolute = path.isAbsolute(repoPath) ? repoPath : path.resolve(repoPath);
  try {
    return await realpath(absolute);
  } catch {
    return absolute;
  }
};

const databaseName = (canonicalRepoPath: string): string => {
  const slug = sanitizeDatabaseIdentifier(sanitizeSlug(path.basename(canonicalRepoPath) || "repo"));
  const hash = createHash("sha256").update(canonicalRepoPath).digest("hex");
  const suffix = hash.slice(0, 12);
  const maxSlugLength = 64 - "odt__".length - suffix.length;
  const truncatedSlug = slug.length > maxSlugLength ? slug.slice(0, maxSlugLength) : slug;
  return `odt_${truncatedSlug}_${suffix}`;
};

const databaseNameForWorkspace = (workspaceId: string): string => {
  const normalizedWorkspaceId = workspaceId.trim();
  const slug = sanitizeDatabaseIdentifier(normalizedWorkspaceId);
  const hash = createHash("sha256").update(normalizedWorkspaceId).digest("hex");
  const suffix = hash.slice(0, 12);
  const maxSlugLength = 64 - "odt__".length - suffix.length;
  const truncatedSlug = slug.length > maxSlugLength ? slug.slice(0, maxSlugLength) : slug;
  return `odt_${truncatedSlug}_${suffix}`;
};

const repoId = (canonicalRepoPath: string): string => {
  const slug = sanitizeSlug(path.basename(canonicalRepoPath) || "repo");
  const hash = createHash("sha256").update(canonicalRepoPath).digest("hex").slice(0, 8);
  return `${slug}-${hash}`;
};

const workspaceRepoId = (workspaceId: string): string => {
  const normalizedWorkspaceId = workspaceId.trim();
  if (!normalizedWorkspaceId) {
    throw new Error("workspaceId is empty; provide a valid workspace id");
  }
  return normalizedWorkspaceId;
};

const readSharedServerState = async (
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

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const processGroupId = (pid: number): number => (process.platform === "win32" ? pid : -pid);

const signalProcess = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(processGroupId(pid), signal);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH") {
      return;
    }
    throw error;
  }
};

const waitForProcessExit = async (pid: number, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processIsAlive(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !processIsAlive(pid);
};

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

  if (processIsAlive(state.pid)) {
    signalProcess(state.pid, "SIGTERM");
    if (!(await waitForProcessExit(state.pid, 2_000))) {
      signalProcess(state.pid, "SIGKILL");
      if (!(await waitForProcessExit(state.pid, 2_000))) {
        throw new Error(`Timed out stopping shared Dolt server process ${state.pid}`);
      }
    }
  }

  await unlink(serverStatePath).catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  });
};

const pathExists = async (inputPath: string): Promise<boolean> => {
  try {
    await access(inputPath);
    return true;
  } catch {
    return false;
  }
};

const tcpProbe = (port: number): Promise<boolean> =>
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

const runDoltAllowFailure = async (args: string[], env: NodeJS.ProcessEnv): Promise<boolean> =>
  new Promise((resolve) => {
    const child = spawn("dolt", args, {
      env,
      stdio: ["ignore", "ignore", "ignore"],
    });
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });

const runCommandAllowFailure: BeadsCommandRunner = async ({ command, args, cwd, env }) =>
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

const sqlProbe = (port: number, env: NodeJS.ProcessEnv): Promise<boolean> =>
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

const serverStateIsHealthy = async (
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

const portIsAvailable = async (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, SHARED_DOLT_SERVER_HOST, () => {
      server.close(() => resolve(true));
    });
  });

const deterministicSharedDoltPortCandidate = async (baseDir: string): Promise<number> => {
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

const wrapPortCandidate = (base: number, offset: number): number => {
  const normalizedBase = base - SHARED_DOLT_PORT_RANGE_START;
  return SHARED_DOLT_PORT_RANGE_START + ((normalizedBase + offset) % SHARED_DOLT_PORT_RANGE_LEN);
};

const yamlQuotePath = (inputPath: string): string => `'${inputPath.replaceAll("'", "''")}'`;

const writeDoltConfigFile = async (paths: BeadsSharedServerPaths, port: number): Promise<void> => {
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

const waitForServerReady = async (port: number, env: NodeJS.ProcessEnv): Promise<boolean> => {
  const deadline = Date.now() + SHARED_DOLT_HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await tcpProbe(port)) && (await sqlProbe(port, env))) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, SHARED_DOLT_HEALTH_POLL_INTERVAL_MS));
  }
  return false;
};

const formatDoltStartupLog = (output: string): string => {
  const cleaned = output.replaceAll("\0", "").trim();
  if (cleaned.length <= MAX_DOLT_STARTUP_LOG_CHARS) {
    return cleaned;
  }
  return cleaned.slice(cleaned.length - MAX_DOLT_STARTUP_LOG_CHARS);
};

const spawnSharedDoltServer = async (
  paths: BeadsSharedServerPaths,
  port: number,
): Promise<BeadsSharedServerState> => {
  const stdout = await open(path.join(paths.sharedServerRoot, "server.stdout.log"), "w");
  const stderrLogPath = path.join(paths.sharedServerRoot, "server.stderr.log");
  const stderr = await open(stderrLogPath, "w");
  const child = spawn("dolt", ["sql-server", "--config", paths.doltConfigFile], {
    cwd: paths.sharedServerRoot,
    detached: process.platform !== "win32",
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

  child.kill();
  const stderrOutput = await readFile(stderrLogPath, "utf8").catch(() => "");
  const detail = formatDoltStartupLog(stderrOutput);
  throw new Error(
    detail
      ? `Shared Dolt server on port ${port} failed to become ready: ${detail}`
      : `Shared Dolt server on port ${port} failed to become ready within ${SHARED_DOLT_HEALTH_TIMEOUT_MS}ms`,
  );
};

const ensureSharedDoltServerRunning = (
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

const writeSharedServerState = async (
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

const defaultEnsureSharedDoltServerRunning: EnsureSharedDoltServer = async (paths) => {
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

const commandFailureReason = (defaultMessage: string, stdout: string, stderr: string): string => {
  const trimmedStderr = stderr.trim();
  if (trimmedStderr) {
    return trimmedStderr;
  }
  const trimmedStdout = stdout.trim();
  return trimmedStdout || defaultMessage;
};

const rewriteNoGitOpsLine = (line: string): string | null => {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith("no-git-ops:")) {
    return null;
  }
  const leadingWhitespace = line.slice(0, line.length - trimmed.length);
  const suffix = trimmed.slice("no-git-ops:".length);
  const commentStart = suffix.indexOf("#");
  const commentSuffix =
    commentStart >= 0
      ? suffix.slice(Math.max(0, suffix.slice(0, commentStart).trimEnd().length))
      : "";
  return `${leadingWhitespace}no-git-ops: true${commentSuffix}`;
};

const ensureNoGitOpsConfig = (config: string): string => {
  let replaced = false;
  const lines: string[] = [];
  for (const line of config.split(/\r?\n/)) {
    const rewritten = rewriteNoGitOpsLine(line);
    if (rewritten !== null) {
      if (!replaced) {
        lines.push(rewritten);
        replaced = true;
      }
      continue;
    }
    lines.push(line);
  }

  if (lines.at(-1) === "") {
    lines.pop();
  }

  if (!replaced) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push("no-git-ops: true");
  }

  return `${lines.join("\n")}\n`;
};

const ensureExistingAttachmentRunsWithoutGitOps = async (beadsDir: string): Promise<void> => {
  if (!(await pathExists(path.join(beadsDir, "metadata.json")))) {
    return;
  }

  const configPath = path.join(beadsDir, "config.yaml");
  const existing = await readFile(configPath, "utf8").catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  const updated = existing === null ? "no-git-ops: true\n" : ensureNoGitOpsConfig(existing);
  if (existing === updated) {
    return;
  }
  const tempPath = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, updated);
  await rename(tempPath, configPath);
};

const runBdForAttachment = async (
  runCommand: BeadsCommandRunner,
  context: BeadsCliContext,
  args: string[],
) => {
  const result = await runCommand({
    command: "bd",
    args,
    cwd: context.workingDir,
    env: context.env,
  });
  if (!result.ok) {
    const command = args[0] ?? "unknown";
    throw new Error(
      `bd ${command} failed: ${commandFailureReason("command failed", result.stdout, result.stderr)}`,
    );
  }
};

const requireSharedServer = (context: BeadsCliContext): BeadsSharedServerState => {
  if (!context.sharedServer) {
    throw new Error(`Shared Dolt server state is missing at ${context.serverStatePath}`);
  }
  return context.sharedServer;
};

const metadataString = (
  metadata: BeadsAttachmentMetadata,
  field: keyof BeadsAttachmentMetadata,
): string | null => {
  const value = metadata[field];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
};

const readAttachmentMetadata = async (beadsDir: string): Promise<BeadsAttachmentMetadata> => {
  const metadataPath = path.join(beadsDir, "metadata.json");
  if (!(await pathExists(metadataPath))) {
    throw new Error(`Beads attachment metadata is missing at ${metadataPath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(metadataPath, "utf8"));
  } catch (error) {
    throw new Error(`Failed parsing Beads attachment metadata ${metadataPath}: ${String(error)}`, {
      cause: error,
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Beads attachment metadata ${metadataPath} must contain a JSON object`);
  }
  return parsed as BeadsAttachmentMetadata;
};

const verifyAttachmentContract = async (context: BeadsCliContext): Promise<void> => {
  const metadata = await readAttachmentMetadata(context.beadsDir);
  const sharedServer = requireSharedServer(context);
  const expectedPort = sharedServer.port;

  if (metadataString(metadata, "backend") !== "dolt") {
    throw new Error(
      `Beads attachment backend is ${JSON.stringify(metadata.backend)}, expected dolt`,
    );
  }
  if (metadataString(metadata, "dolt_mode") !== "server") {
    throw new Error(
      `Beads attachment mode is ${JSON.stringify(metadata.dolt_mode)}, expected server`,
    );
  }
  if (metadataString(metadata, "dolt_server_host") !== SHARED_DOLT_SERVER_HOST) {
    throw new Error(
      `Beads attachment host is ${JSON.stringify(
        metadata.dolt_server_host,
      )}, expected ${SHARED_DOLT_SERVER_HOST}`,
    );
  }
  if (metadata.dolt_server_port !== expectedPort) {
    throw new Error(
      `Beads attachment port is ${JSON.stringify(metadata.dolt_server_port)}, expected ${expectedPort}`,
    );
  }
  if (metadataString(metadata, "dolt_server_user") !== SHARED_DOLT_SERVER_USER) {
    throw new Error(
      `Beads attachment user is ${JSON.stringify(
        metadata.dolt_server_user,
      )}, expected ${SHARED_DOLT_SERVER_USER}`,
    );
  }
  if (metadataString(metadata, "dolt_database") !== context.databaseName) {
    throw new Error(
      `Beads attachment database is ${JSON.stringify(
        metadata.dolt_database,
      )}, expected ${context.databaseName}`,
    );
  }
};

const databaseListContains = (output: string, expectedDatabase: string): boolean =>
  output.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    return (
      trimmed === expectedDatabase ||
      trimmed
        .split("|")
        .map((cell) => cell.trim())
        .some((cell) => cell === expectedDatabase)
    );
  });

const probeSharedDatabasePresence = async (
  runCommand: BeadsCommandRunner,
  context: BeadsCliContext,
): Promise<"available" | "missing"> => {
  const sharedServer = requireSharedServer(context);
  const result = await runCommand({
    command: "dolt",
    args: [
      "--host",
      sharedServer.host || SHARED_DOLT_SERVER_HOST,
      "--port",
      String(sharedServer.port),
      "--no-tls",
      "-u",
      sharedServer.user || SHARED_DOLT_SERVER_USER,
      "-p",
      "",
      "sql",
      "-q",
      "show databases",
    ],
    env: context.env,
  });

  if (!result.ok) {
    throw new Error(
      `Shared Dolt database probe failed: ${commandFailureReason(
        "Shared Dolt database probe failed",
        result.stdout,
        result.stderr,
      )}`,
    );
  }
  if (!result.stdout.trim()) {
    throw new Error("Shared Dolt database probe returned empty output");
  }
  return databaseListContains(result.stdout, context.databaseName) ? "available" : "missing";
};

const parseBdWherePayload = (payload: string): BeadsWherePayload => {
  const parsed = JSON.parse(payload) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("bd where --json payload must be an object");
  }
  return parsed as BeadsWherePayload;
};

const tryParseBdWherePayload = (payload: string): BeadsWherePayload | null => {
  try {
    return parseBdWherePayload(payload);
  } catch {
    return null;
  }
};

const bdWherePayloadFromOutput = (
  ok: boolean,
  stdout: string,
  stderr: string,
): BeadsWherePayload => {
  const stderrPayload = stderr.trim();
  if (stderrPayload) {
    const parsed = tryParseBdWherePayload(stderrPayload);
    if (parsed) {
      return parsed;
    }
  }

  const stdoutPayload = stdout.trim();
  if (stdoutPayload) {
    return parseBdWherePayload(stdoutPayload);
  }

  if (ok) {
    throw new Error("bd where --json exited successfully but returned no JSON payload");
  }
  throw new Error("bd where --json exited unsuccessfully without a decodable JSON payload");
};

const canonicalPathsMatch = async (actualPath: string, expectedPath: string): Promise<boolean> => {
  const [actual, expected] = await Promise.all([realpath(actualPath), realpath(expectedPath)]);
  return actual === expected;
};

const verifyBeadsWhere = async (
  runCommand: BeadsCommandRunner,
  context: BeadsCliContext,
): Promise<BeadsReadiness> => {
  const result = await runCommand({
    command: "bd",
    args: ["where", "--json"],
    cwd: context.workingDir,
    env: context.env,
  });
  const payload = bdWherePayloadFromOutput(result.ok, result.stdout, result.stderr);
  const foundPath = typeof payload.path === "string" ? payload.path.trim() : "";
  const foundError = typeof payload.error === "string" ? payload.error.trim() : "";
  if (foundPath && foundError) {
    throw new Error("bd where --json returned both path and error");
  }
  if (foundPath) {
    if (await canonicalPathsMatch(foundPath, context.beadsDir)) {
      return { type: "ready" };
    }
    return {
      type: "attachment_verification_failed",
      reason: `Beads attachment resolves to ${foundPath}, expected ${context.beadsDir}`,
    };
  }
  if (foundError) {
    return { type: "attachment_verification_failed", reason: foundError };
  }
  throw new Error("bd where --json returned a JSON payload without path or error");
};

const verifyBeadsReadiness = async (
  runCommand: BeadsCommandRunner,
  context: BeadsCliContext,
): Promise<BeadsReadiness> => {
  if (!(await pathExists(context.beadsDir))) {
    return { type: "missing_attachment" };
  }
  await verifyAttachmentContract(context);
  const sharedDatabase = await probeSharedDatabasePresence(runCommand, context);
  if (sharedDatabase === "missing") {
    return { type: "missing_shared_database" };
  }
  return verifyBeadsWhere(runCommand, context);
};

const restoreSharedDatabaseFromAttachmentBackup = async (
  runCommand: BeadsCommandRunner,
  context: BeadsCliContext,
): Promise<void> => {
  const backupDir = path.join(context.beadsDir, "backup");
  if (!(await pathExists(backupDir))) {
    throw new Error(
      `Shared Dolt database is missing for ${context.beadsDir} and no attachment backup exists at ${backupDir}`,
    );
  }
  const sharedServer = requireSharedServer(context);
  const backupUrl = `file://${backupDir}`;
  const result = await runCommand({
    command: "dolt",
    args: ["backup", "restore", backupUrl, context.databaseName],
    cwd: sharedServer.doltDataDir,
    env: context.env,
  });
  if (!result.ok) {
    throw new Error(
      `Failed to restore shared Dolt database ${context.databaseName}: ${commandFailureReason(
        "restore failed",
        result.stdout,
        result.stderr,
      )}`,
    );
  }
};

const ensureRepoReadyAfterRecovery = async (
  runCommand: BeadsCommandRunner,
  context: BeadsCliContext,
  recoveryStep: string,
): Promise<void> => {
  const readiness = await verifyBeadsReadiness(runCommand, context);
  if (readiness.type === "ready") {
    return;
  }
  const reason =
    readiness.type === "attachment_verification_failed"
      ? readiness.reason
      : readiness.type === "missing_shared_database"
        ? `Shared Dolt database ${context.databaseName} is missing`
        : "Beads attachment is missing";
  throw new Error(
    `Beads ${recoveryStep} completed but store is still not ready at ${context.beadsDir}: ${reason}`,
  );
};

const initializeMissingAttachment = async (
  runCommand: BeadsCommandRunner,
  context: BeadsCliContext,
): Promise<void> => {
  const serverPort = context.sharedServer?.port;
  if (!serverPort) {
    throw new Error(`Missing shared Dolt server port while initializing ${context.beadsDir}`);
  }
  const result = await runCommand({
    command: "bd",
    args: [
      "init",
      "--server",
      "--server-host",
      SHARED_DOLT_SERVER_HOST,
      "--server-port",
      String(serverPort),
      "--server-user",
      SHARED_DOLT_SERVER_USER,
      "--quiet",
      "--stealth",
      "--skip-hooks",
      "--skip-agents",
      "--prefix",
      sanitizeSlug(path.basename(context.repoPath) || "repo"),
      "--database",
      context.databaseName,
    ],
    cwd: context.workingDir,
    env: context.env,
  });
  if (!result.ok) {
    throw new Error(
      `Failed to initialize Beads attachment at ${context.beadsDir}: ${commandFailureReason(
        "Beads attachment is missing",
        result.stdout,
        result.stderr,
      )}`,
    );
  }
};

export const createBeadsAttachmentProvisioner =
  (runCommand: BeadsCommandRunner = runCommandAllowFailure): EnsureBeadsAttachment =>
  async (context) => {
    await mkdir(context.workingDir, { recursive: true });
    await ensureExistingAttachmentRunsWithoutGitOps(context.beadsDir);

    const readiness = await verifyBeadsReadiness(runCommand, context);
    if (readiness.type === "missing_attachment") {
      await initializeMissingAttachment(runCommand, context);
      await ensureExistingAttachmentRunsWithoutGitOps(context.beadsDir);
      await ensureRepoReadyAfterRecovery(runCommand, context, "init");
    } else if (readiness.type === "missing_shared_database") {
      await restoreSharedDatabaseFromAttachmentBackup(runCommand, context);
      await ensureRepoReadyAfterRecovery(runCommand, context, "shared database restore");
    } else if (readiness.type === "attachment_verification_failed") {
      await runBdForAttachment(runCommand, context, ["doctor", "--fix", "--yes"]);
      await ensureExistingAttachmentRunsWithoutGitOps(context.beadsDir);
      await ensureRepoReadyAfterRecovery(runCommand, context, "repair");
    }

    await ensureExistingAttachmentRunsWithoutGitOps(context.beadsDir);
    await runBdForAttachment(runCommand, context, [
      "config",
      "set",
      "status.custom",
      CUSTOM_STATUS_VALUES,
    ]);
  };

const defaultEnsureBeadsAttachment = createBeadsAttachmentProvisioner();

export const sharedServerHealthFromContext = (
  context: BeadsCliContext,
): RepoStoreHealth["sharedServer"] => {
  const sharedServer = context.sharedServer;
  if (!sharedServer) {
    return {
      host: null,
      port: null,
      ownershipState: "unavailable",
    };
  }

  const ownershipState =
    sharedServer.ownerPid !== process.pid
      ? "reused_existing_server"
      : sharedServer.acquisition === "adopted_orphaned_server"
        ? "adopted_orphaned_server"
        : "owned_by_current_process";

  return {
    host: sharedServer.host,
    port: sharedServer.port,
    ownershipState,
  };
};

export const resolveBeadsCliContext = async (
  repoPath: string,
  options: ResolveBeadsCliContextOptions = {},
): Promise<BeadsCliContext> => {
  const processEnv = options.processEnv ?? process.env;
  const canonicalRepoPath = await canonicalOrAbsolute(repoPath);
  const baseDir = resolveOpenDucktorBaseDir(processEnv);
  const beadsRoot = path.join(baseDir, "beads");
  const sharedServerRoot = path.join(beadsRoot, "shared-server");
  const doltRoot = path.join(sharedServerRoot, "dolt");
  const cfgDir = path.join(sharedServerRoot, ".doltcfg");
  const resolvedWorkspaceId =
    typeof options.workspaceId === "string" && options.workspaceId.trim().length > 0
      ? options.workspaceId.trim()
      : null;
  const resolvedRepoId = resolvedWorkspaceId
    ? workspaceRepoId(resolvedWorkspaceId)
    : repoId(canonicalRepoPath);
  const resolvedDatabaseName = resolvedWorkspaceId
    ? databaseNameForWorkspace(resolvedWorkspaceId)
    : databaseName(canonicalRepoPath);
  const attachmentRoot = path.join(beadsRoot, resolvedRepoId);
  const beadsDir = path.join(attachmentRoot, ".beads");
  const serverStatePath = path.join(sharedServerRoot, "server.json");
  const sharedServerPaths: BeadsSharedServerPaths = {
    baseDir,
    beadsRoot,
    sharedServerRoot,
    doltRoot,
    cfgDir,
    doltConfigFile: path.join(sharedServerRoot, "dolt-config.yaml"),
    env: processEnv,
    serverStatePath,
  };
  let sharedServer = await readSharedServerState(serverStatePath);

  if (options.requireSharedServer === true) {
    await mkdir(attachmentRoot, { recursive: true });
    sharedServer = await ensureSharedDoltServerRunning(
      sharedServerPaths,
      options.ensureSharedServer ?? defaultEnsureSharedDoltServerRunning,
    );
  }

  const env: NodeJS.ProcessEnv = {
    ...processEnv,
    BEADS_DIR: beadsDir,
  };

  if (sharedServer) {
    env.BEADS_DOLT_SERVER_MODE = "1";
    env.BEADS_DOLT_SERVER_HOST = sharedServer.host || SHARED_DOLT_SERVER_HOST;
    env.BEADS_DOLT_SERVER_PORT = String(sharedServer.port);
    env.BEADS_DOLT_SERVER_USER = sharedServer.user || SHARED_DOLT_SERVER_USER;
  }

  const context = {
    repoPath: canonicalRepoPath,
    repoId: resolvedRepoId,
    databaseName: resolvedDatabaseName,
    attachmentRoot,
    beadsDir,
    workingDir: attachmentRoot,
    serverStatePath,
    sharedServer,
    env,
  };

  if (options.requireSharedServer === true) {
    await (options.ensureAttachment ?? defaultEnsureBeadsAttachment)(context);
  }

  return context;
};
