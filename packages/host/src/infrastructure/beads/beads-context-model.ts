import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const OPENDUCKTOR_CONFIG_DIR_ENV = "OPENDUCKTOR_CONFIG_DIR";
export const DEFAULT_CONFIG_DIR_NAME = ".openducktor";
export const SHARED_DOLT_SERVER_HOST = "127.0.0.1";
export const SHARED_DOLT_SERVER_USER = "root";
export const SHARED_DOLT_PORT_RANGE_START = 36_000;
export const SHARED_DOLT_PORT_RANGE_LEN = 10_000;
export const SHARED_DOLT_HEALTH_TIMEOUT_MS = 5_000;
export const SHARED_DOLT_HEALTH_POLL_INTERVAL_MS = 100;
export const SHARED_DOLT_TCP_TIMEOUT_MS = 250;
export const CUSTOM_STATUS_VALUES = "spec_ready,ready_for_dev,ai_review,human_review";
export const MAX_DOLT_STARTUP_LOG_CHARS = 4_000;

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

export type BeadsAttachmentMetadata = {
  backend?: unknown;
  dolt_mode?: unknown;
  dolt_server_host?: unknown;
  dolt_server_port?: unknown;
  dolt_server_user?: unknown;
  dolt_database?: unknown;
};

export const sharedDoltServerFlights = new Map<string, Promise<BeadsSharedServerState>>();

export type BeadsWherePayload = {
  path?: unknown;
  error?: unknown;
};

export type BeadsReadiness =
  | { type: "ready" }
  | { type: "missing_attachment" }
  | { type: "missing_shared_database" }
  | { type: "attachment_verification_failed"; reason: string };

export const stripMatchingQuotes = (value: string): string => {
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

export const resolveHomeDirectory = (): string => {
  const home = homedir();
  if (home.trim().length > 0) {
    return home;
  }

  throw new Error("Unable to resolve user home directory");
};

export const resolveUserPath = (rawPath: string): string => {
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

export const resolveOpenDucktorBaseDir = (env: NodeJS.ProcessEnv = process.env): string => {
  const envDir = env[OPENDUCKTOR_CONFIG_DIR_ENV];
  if (envDir !== undefined) {
    if (envDir.length === 0) {
      throw new Error("OPENDUCKTOR_CONFIG_DIR is set but empty; provide a valid directory path");
    }

    return resolveUserPath(envDir);
  }

  return path.join(resolveHomeDirectory(), DEFAULT_CONFIG_DIR_NAME);
};

export const sanitizeSlug = (input: string): string => {
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

export const sanitizeDatabaseIdentifier = (input: string): string => {
  const sanitized = Array.from(input)
    .map((character) => (/^[a-z0-9]$/i.test(character) ? character.toLowerCase() : "_"))
    .join("");
  const trimmed = sanitized.replace(/^_+|_+$/g, "");
  return trimmed.length > 0 ? trimmed : "repo";
};

export const canonicalOrAbsolute = async (repoPath: string): Promise<string> => {
  const absolute = path.isAbsolute(repoPath) ? repoPath : path.resolve(repoPath);
  try {
    return await realpath(absolute);
  } catch {
    return absolute;
  }
};

export const databaseName = (canonicalRepoPath: string): string => {
  const slug = sanitizeDatabaseIdentifier(sanitizeSlug(path.basename(canonicalRepoPath) || "repo"));
  const hash = createHash("sha256").update(canonicalRepoPath).digest("hex");
  const suffix = hash.slice(0, 12);
  const maxSlugLength = 64 - "odt__".length - suffix.length;
  const truncatedSlug = slug.length > maxSlugLength ? slug.slice(0, maxSlugLength) : slug;
  return `odt_${truncatedSlug}_${suffix}`;
};

export const databaseNameForWorkspace = (workspaceId: string): string => {
  const normalizedWorkspaceId = workspaceId.trim();
  const slug = sanitizeDatabaseIdentifier(normalizedWorkspaceId);
  const hash = createHash("sha256").update(normalizedWorkspaceId).digest("hex");
  const suffix = hash.slice(0, 12);
  const maxSlugLength = 64 - "odt__".length - suffix.length;
  const truncatedSlug = slug.length > maxSlugLength ? slug.slice(0, maxSlugLength) : slug;
  return `odt_${truncatedSlug}_${suffix}`;
};

export const repoId = (canonicalRepoPath: string): string => {
  const slug = sanitizeSlug(path.basename(canonicalRepoPath) || "repo");
  const hash = createHash("sha256").update(canonicalRepoPath).digest("hex").slice(0, 8);
  return `${slug}-${hash}`;
};

export const workspaceRepoId = (workspaceId: string): string => {
  const normalizedWorkspaceId = workspaceId.trim();
  if (!normalizedWorkspaceId) {
    throw new Error("workspaceId is empty; provide a valid workspace id");
  }
  return normalizedWorkspaceId;
};
