import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { Effect, type Fiber } from "effect";
import {
  type HostDependencyError,
  type HostOperationError,
  type HostPathAccessError,
  type HostPathNotFoundError,
  type HostResourceError,
  HostValidationError,
} from "../../effect/host-errors";

export {
  DEFAULT_CONFIG_DIR_NAME,
  OPENDUCKTOR_CONFIG_DIR_ENV,
  resolveHomeDirectory,
  resolveOpenDucktorBaseDir,
  resolveUserPath,
  stripMatchingQuotes,
} from "../../config/openducktor-config-dir";
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
  tools: SharedDoltToolPaths;
};

export type BeadsToolPaths = {
  beads: string;
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
  tools: BeadsToolPaths;
};

export type SharedDoltToolPaths = {
  dolt: string;
};

export type BeadsSharedServerContext = Omit<BeadsCliContext, "sharedServer"> & {
  sharedServer: BeadsSharedServerState;
  sharedDoltTools: SharedDoltToolPaths;
};

export type BeadsInfrastructureError =
  | HostOperationError
  | HostPathAccessError
  | HostPathNotFoundError
  | HostResourceError
  | HostValidationError;

export type BeadsCliContextResolutionError = BeadsInfrastructureError | HostDependencyError;

export type EnsureSharedDoltServer = (
  paths: BeadsSharedServerPaths,
) => Effect.Effect<BeadsSharedServerState, BeadsInfrastructureError>;

export type EnsureBeadsAttachment = (
  context: BeadsSharedServerContext,
) => Effect.Effect<void, BeadsInfrastructureError>;

export type BeadsCommandRunner = (input: {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}) => Effect.Effect<{ ok: boolean; stdout: string; stderr: string }, BeadsInfrastructureError>;

export type ResolveBeadsCliContextOptions = {
  requireSharedServer?: boolean;
  ensureSharedServer?: EnsureSharedDoltServer;
  ensureAttachment?: EnsureBeadsAttachment;
  processEnv?: NodeJS.ProcessEnv;
  sharedDoltTools?: SharedDoltToolPaths;
  tools?: BeadsToolPaths;
  workspaceId?: string | null;
};

export type ResolveBeadsSharedServerContextOptions = ResolveBeadsCliContextOptions & {
  requireSharedServer: true;
};

export type ResolveBeadsOptionalServerContextOptions = ResolveBeadsCliContextOptions & {
  requireSharedServer?: false | undefined;
};

export type BeadsAttachmentMetadata = {
  backend?: unknown;
  dolt_mode?: unknown;
  dolt_server_host?: unknown;
  dolt_server_port?: unknown;
  dolt_server_user?: unknown;
  dolt_database?: unknown;
};

export const sharedDoltServerFlights = new Map<
  string,
  Fiber.RuntimeFiber<BeadsSharedServerState, BeadsInfrastructureError>
>();

export type BeadsWherePayload = {
  path?: unknown;
  error?: unknown;
};

export type BeadsReadiness =
  | { type: "ready" }
  | { type: "missing_attachment" }
  | { type: "missing_shared_database" }
  | { type: "attachment_verification_failed"; reason: string };

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

export const canonicalOrAbsolute = (repoPath: string): Effect.Effect<string> => {
  const absolute = path.isAbsolute(repoPath) ? repoPath : path.resolve(repoPath);
  return Effect.tryPromise(() => realpath(absolute)).pipe(
    Effect.catchAll(() => Effect.succeed(absolute)),
  );
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
    throw new HostValidationError({
      message: "workspaceId is empty; provide a valid workspace id",
      field: "workspaceId",
    });
  }
  return normalizedWorkspaceId;
};
