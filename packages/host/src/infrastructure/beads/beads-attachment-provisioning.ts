import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RepoStoreHealth } from "@openducktor/contracts";
import {
  type BeadsAttachmentMetadata,
  type BeadsCliContext,
  type BeadsCommandRunner,
  type BeadsReadiness,
  type BeadsSharedServerState,
  type BeadsWherePayload,
  CUSTOM_STATUS_VALUES,
  type EnsureBeadsAttachment,
  SHARED_DOLT_SERVER_HOST,
  SHARED_DOLT_SERVER_USER,
  sanitizeSlug,
} from "./beads-context-model";
import { pathExists, runCommandAllowFailure } from "./beads-shared-dolt-server";

export const commandFailureReason = (
  defaultMessage: string,
  stdout: string,
  stderr: string,
): string => {
  const trimmedStderr = stderr.trim();
  if (trimmedStderr) {
    return trimmedStderr;
  }
  const trimmedStdout = stdout.trim();
  return trimmedStdout || defaultMessage;
};

export const rewriteNoGitOpsLine = (line: string): string | null => {
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

export const ensureNoGitOpsConfig = (config: string): string => {
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

export const ensureExistingAttachmentRunsWithoutGitOps = async (
  beadsDir: string,
): Promise<void> => {
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

export const runBdForAttachment = async (
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

export const requireSharedServer = (context: BeadsCliContext): BeadsSharedServerState => {
  if (!context.sharedServer) {
    throw new Error(`Shared Dolt server state is missing at ${context.serverStatePath}`);
  }
  return context.sharedServer;
};

export const metadataString = (
  metadata: BeadsAttachmentMetadata,
  field: keyof BeadsAttachmentMetadata,
): string | null => {
  const value = metadata[field];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
};

export const readAttachmentMetadata = async (
  beadsDir: string,
): Promise<BeadsAttachmentMetadata> => {
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

export const verifyAttachmentContract = async (context: BeadsCliContext): Promise<void> => {
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

export const databaseListContains = (output: string, expectedDatabase: string): boolean =>
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

export const probeSharedDatabasePresence = async (
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

export const parseBdWherePayload = (payload: string): BeadsWherePayload => {
  const parsed = JSON.parse(payload) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("bd where --json payload must be an object");
  }
  return parsed as BeadsWherePayload;
};

export const tryParseBdWherePayload = (payload: string): BeadsWherePayload | null => {
  try {
    return parseBdWherePayload(payload);
  } catch {
    return null;
  }
};

export const bdWherePayloadFromOutput = (
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

export const canonicalPathsMatch = async (
  actualPath: string,
  expectedPath: string,
): Promise<boolean> => {
  const [actual, expected] = await Promise.all([realpath(actualPath), realpath(expectedPath)]);
  return actual === expected;
};

export const verifyBeadsWhere = async (
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

export const verifyBeadsReadiness = async (
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

export const restoreSharedDatabaseFromAttachmentBackup = async (
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

export const ensureRepoReadyAfterRecovery = async (
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

export const initializeMissingAttachment = async (
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

export const defaultEnsureBeadsAttachment = createBeadsAttachmentProvisioner();

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
