import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, resolve } from "node:path";

export const CUSTOM_STATUS_VALUES = "spec_ready,ready_for_dev,ai_review,human_review";

export const nowIso = (): string => new Date().toISOString();

const EMPTY_ENV_SENTINELS = new Set(["undefined", "null"]);

export const normalizeOptionalInput = (value: string | undefined): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (EMPTY_ENV_SENTINELS.has(trimmed.toLowerCase())) {
    return undefined;
  }
  return trimmed;
};

const stripMatchingQuotes = (value: string): string => {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return value.slice(1, -1).trim();
    }
  }
  return value;
};

const normalizeOptionalPathInput = (value: string | undefined): string | undefined => {
  const normalized = normalizeOptionalInput(value);
  if (!normalized) {
    return undefined;
  }

  const unquoted = stripMatchingQuotes(normalized);
  if (unquoted === "~") {
    return homedir();
  }
  if (unquoted.startsWith("~/") || unquoted.startsWith("~\\")) {
    return resolve(homedir(), unquoted.slice(2));
  }
  return unquoted;
};

export const sanitizeSlug = (input: string): string => {
  let slug = "";
  let lastDash = false;

  for (const char of input) {
    const lower = char.toLowerCase();
    if (/^[\x30-\x39\x61-\x7a]$/.test(lower)) {
      slug += lower;
      lastDash = false;
      continue;
    }
    if (!lastDash) {
      slug += "-";
      lastDash = true;
    }
  }

  slug = slug.replace(/^-+/, "").replace(/-+$/, "");
  return slug.length > 0 ? slug : "repo";
};

export type ProcessResult = { ok: boolean; stdout: string; stderr: string };
export type ProcessRunner = (
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
) => Promise<ProcessResult>;
export type BeadsAttachmentDirResolver = (repoPath: string) => Promise<string>;
export type TimeProvider = () => string;

export const commandEnvOverrideName = (command: string): string => {
  const sanitized = command
    .split("")
    .map((character) => (/^[a-z0-9]$/i.test(character) ? character.toUpperCase() : "_"))
    .join("");
  return `OPENDUCKTOR_${sanitized}_PATH`;
};

const DEFAULT_WINDOWS_EXECUTABLE_EXTENSIONS = [".exe", ".cmd", ".bat", ".com"];

const normalizeWindowsExecutableExtension = (extension: string): string => {
  const trimmed = extension.trim();
  if (trimmed.length === 0) {
    return "";
  }
  return (trimmed.startsWith(".") ? trimmed : `.${trimmed}`).toLowerCase();
};

export const bundledCommandCandidates = (
  command: string,
  platform = process.platform,
  pathExt = process.env.PATHEXT,
): string[] => {
  if (platform !== "win32") {
    return [command];
  }

  if (extname(command).length > 0) {
    return [command];
  }

  const configuredExtensions = normalizeOptionalInput(pathExt)
    ?.split(";")
    .map(normalizeWindowsExecutableExtension)
    .filter((extension) => extension.length > 0);
  const extensions =
    configuredExtensions && configuredExtensions.length > 0
      ? configuredExtensions
      : DEFAULT_WINDOWS_EXECUTABLE_EXTENSIONS;

  return [command, ...extensions.map((extension) => `${command}${extension}`)];
};

export const resolveBundledCommandPath = (
  command: string,
  platform = process.platform,
  pathExt = process.env.PATHEXT,
  executablePath = process.execPath,
): string | null => {
  for (const candidateName of bundledCommandCandidates(command, platform, pathExt)) {
    const sibling = resolve(dirname(executablePath), candidateName);
    if (existsSync(sibling) && statSync(sibling).isFile()) {
      return sibling;
    }
  }
  return null;
};

export const resolveCommandExecutable = (command: string): string => {
  if (command.includes("/") || command.includes("\\")) {
    return command;
  }

  const overrideName = commandEnvOverrideName(command);
  const explicit = normalizeOptionalPathInput(process.env[overrideName]);
  if (explicit) {
    if (!existsSync(explicit) || !statSync(explicit).isFile()) {
      throw new Error(
        `Configured command override ${overrideName} points to a missing file: ${explicit}`,
      );
    }
    return explicit;
  }

  return resolveBundledCommandPath(command) ?? command;
};

export const runProcess: ProcessRunner = async (
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
): Promise<ProcessResult> => {
  return new Promise((resolvePromise, rejectPromise) => {
    const executable = resolveCommandExecutable(command);
    const child = spawn(executable, args, {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      rejectPromise(error);
    });

    child.on("close", (code) => {
      resolvePromise({
        ok: code === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
};

export const resolveCanonicalPath = async (pathValue: string): Promise<string> => {
  const absolute = resolve(pathValue);
  try {
    return await realpath(absolute);
  } catch {
    return absolute;
  }
};

export const computeRepoId = async (repoPath: string): Promise<string> => {
  const canonical = await resolveCanonicalPath(repoPath);
  const slug = sanitizeSlug(basename(canonical));
  const digest = createHash("sha256").update(canonical).digest("hex").slice(0, 8);
  return `${slug}-${digest}`;
};

const sanitizeDatabaseIdentifier = (input: string): string => {
  const sanitized = input
    .split("")
    .map((char) => {
      const lower = char.toLowerCase();
      if (/^[\x30-\x39\x61-\x7a]$/.test(lower)) {
        return lower;
      }
      return "_";
    })
    .join("")
    .replace(/^_+|_+$/g, "");
  return sanitized.length > 0 ? sanitized : "repo";
};

export const computeBeadsDatabaseName = async (repoPath: string): Promise<string> => {
  const canonicalRepoPath = await resolveCanonicalPath(repoPath);
  const slug = sanitizeDatabaseIdentifier(sanitizeSlug(basename(canonicalRepoPath)));
  const hashSuffix = createHash("sha256").update(canonicalRepoPath).digest("hex").slice(0, 12);
  const maxSlugLength = 64 - "odt__".length - hashSuffix.length;
  const truncatedSlug = slug.slice(0, maxSlugLength);
  return `odt_${truncatedSlug}_${hashSuffix}`;
};

export const resolveConfigRoot = (): string => {
  const configuredRoot = normalizeOptionalPathInput(process.env.OPENDUCKTOR_CONFIG_DIR);
  return configuredRoot ?? resolve(homedir(), ".openducktor");
};

export const resolveBeadsRoot = (): string => resolve(resolveConfigRoot(), "beads");

export const resolveRepoBeadsAttachmentDir = async (repoPath: string): Promise<string> => {
  const repoId = await computeRepoId(repoPath);
  const root = resolve(resolveBeadsRoot(), repoId);
  return resolve(root, ".beads");
};

export const resolveRepoLiveDatabaseDir = async (repoPath: string): Promise<string> => {
  return resolve(
    resolveBeadsRoot(),
    "shared-server",
    "dolt",
    await computeBeadsDatabaseName(repoPath),
  );
};
