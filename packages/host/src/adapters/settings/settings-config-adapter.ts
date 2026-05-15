import { createHash } from "node:crypto";
import { access, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { GlobalConfig } from "@openducktor/contracts";
import type { SettingsConfigPort } from "../../ports/settings-config-port";

const OPENDUCKTOR_CONFIG_DIR_ENV = "OPENDUCKTOR_CONFIG_DIR";
const DEFAULT_CONFIG_DIR_NAME = ".openducktor";
const USER_SETTINGS_FILENAME = "config.json";

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

const resolveOpenDucktorBaseDir = (): string => {
  const envDir = process.env[OPENDUCKTOR_CONFIG_DIR_ENV];
  if (envDir !== undefined) {
    if (envDir.length === 0) {
      throw new Error("OPENDUCKTOR_CONFIG_DIR is set but empty; provide a valid directory path");
    }

    return resolveUserPath(envDir);
  }

  return path.join(resolveHomeDirectory(), DEFAULT_CONFIG_DIR_NAME);
};

const sanitizeRepoSlug = (input: string): string => {
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

const repoId = (repoPath: string): string => {
  const absolute = path.isAbsolute(repoPath) ? repoPath : path.resolve(repoPath);
  const slug = sanitizeRepoSlug(path.basename(absolute) || "repo");
  const hash = createHash("sha256").update(absolute).digest("hex").slice(0, 8);
  return `${slug}-${hash}`;
};

export type CreateSettingsConfigAdapterInput = {
  configPath?: string;
};

export const createSettingsConfigAdapter = ({
  configPath,
}: CreateSettingsConfigAdapterInput = {}): SettingsConfigPort => {
  const resolvedConfigPath =
    configPath ?? path.join(resolveOpenDucktorBaseDir(), USER_SETTINGS_FILENAME);
  const baseDir = path.dirname(resolvedConfigPath);

  return {
    async readConfig() {
      let payload: string;
      try {
        payload = await readFile(resolvedConfigPath, "utf8");
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return null;
        }

        throw new Error(`Failed reading config file ${resolvedConfigPath}: ${String(error)}`, {
          cause: error,
        });
      }

      try {
        return JSON.parse(payload) as unknown;
      } catch (error) {
        throw new Error(`Failed parsing config file ${resolvedConfigPath}: ${String(error)}`, {
          cause: error,
        });
      }
    },
    async writeConfig(config: GlobalConfig) {
      await mkdir(baseDir, { recursive: true }).catch((error: unknown) => {
        throw new Error(`Failed creating config directory ${baseDir}: ${String(error)}`, {
          cause: error,
        });
      });

      const tempPath = path.join(
        baseDir,
        `.${path.basename(resolvedConfigPath)}.tmp-${process.pid}-${Date.now()}`,
      );
      const payload = `${JSON.stringify(config, null, 2)}\n`;

      try {
        await writeFile(tempPath, payload, { mode: 0o600 });
        await rename(tempPath, resolvedConfigPath);
      } catch (error) {
        throw new Error(`Failed writing config file ${resolvedConfigPath}: ${String(error)}`, {
          cause: error,
        });
      }
    },
    defaultWorktreeBasePath(workspaceId) {
      return path.join(baseDir, "worktrees", workspaceId.trim());
    },
    defaultRepoWorktreeBasePath(repoPath) {
      return path.join(baseDir, "worktrees", repoId(repoPath.trim()));
    },
    resolveConfiguredPath(rawPath) {
      return resolveUserPath(rawPath);
    },
    canonicalizePath(rawPath) {
      return realpath(rawPath);
    },
    async pathExists(inputPath) {
      try {
        await access(inputPath);
        return true;
      } catch {
        return false;
      }
    },
    join(...paths) {
      return path.join(...paths);
    },
  };
};
