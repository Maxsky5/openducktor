import { createHash } from "node:crypto";
import { access, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { GlobalConfig } from "@openducktor/contracts";
import { Effect, Layer } from "effect";
import {
  HostOperationError,
  HostValidationError,
  toHostOperationError,
  toHostPathStatError,
} from "../../effect/host-errors";
import { type SettingsConfigPort, SettingsConfigPortTag } from "../../ports/settings-config-port";

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

  throw new HostValidationError({ message: "Unable to resolve user home directory" });
};

const resolveUserPath = (rawPath: string): string => {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    throw new HostValidationError({ message: "Path is empty; provide a valid path" });
  }

  const unquoted = stripMatchingQuotes(trimmed);
  if (!unquoted) {
    throw new HostValidationError({ message: "Path is empty; provide a valid path" });
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
      throw new HostValidationError({
        message: "OPENDUCKTOR_CONFIG_DIR is set but empty; provide a valid directory path",
      });
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
    readConfig() {
      return Effect.gen(function* () {
        const payload = yield* Effect.tryPromise({
          try: () => readFile(resolvedConfigPath, "utf8"),
          catch: (cause) =>
            toHostOperationError(cause, "settingsConfig.readConfig", { path: resolvedConfigPath }),
        }).pipe(
          Effect.catchTag("HostOperationError", (error) => {
            if (
              typeof error.cause === "object" &&
              error.cause !== null &&
              "code" in error.cause &&
              error.cause.code === "ENOENT"
            ) {
              return Effect.succeed(null);
            }

            return Effect.fail(error);
          }),
        );
        if (payload === null) {
          return null;
        }

        return yield* Effect.try({
          try: () => JSON.parse(payload) as unknown,
          catch: (cause) =>
            toHostOperationError(cause, "settingsConfig.parseConfig", {
              path: resolvedConfigPath,
            }),
        }).pipe(
          Effect.mapError(
            (error) =>
              new HostOperationError({
                operation: "settingsConfig.parseConfig",
                message: `Failed parsing config file ${resolvedConfigPath}: ${error.message}`,
                cause: error,
                details: { path: resolvedConfigPath },
              }),
          ),
        );
      });
    },
    writeConfig(config: GlobalConfig) {
      return Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: () => mkdir(baseDir, { recursive: true }).then(() => undefined),
          catch: (cause) =>
            toHostOperationError(cause, "settingsConfig.createConfigDirectory", { path: baseDir }),
        }).pipe(
          Effect.mapError(
            (error) =>
              new HostOperationError({
                operation: "settingsConfig.createConfigDirectory",
                message: `Failed creating config directory ${baseDir}: ${error.message}`,
                cause: error,
                details: { path: baseDir },
              }),
          ),
        );

        const tempPath = path.join(
          baseDir,
          `.${path.basename(resolvedConfigPath)}.tmp-${process.pid}-${Date.now()}`,
        );
        const payload = `${JSON.stringify(config, null, 2)}\n`;

        yield* Effect.tryPromise({
          try: async () => {
            await writeFile(tempPath, payload, { mode: 0o600 });
            await rename(tempPath, resolvedConfigPath);
          },
          catch: (cause) =>
            toHostOperationError(cause, "settingsConfig.writeConfig", {
              path: resolvedConfigPath,
              tempPath,
            }),
        }).pipe(
          Effect.mapError(
            (error) =>
              new HostOperationError({
                operation: "settingsConfig.writeConfig",
                message: `Failed writing config file ${resolvedConfigPath}: ${error.message}`,
                cause: error,
                details: { path: resolvedConfigPath, tempPath },
              }),
          ),
        );
      });
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
      return Effect.tryPromise({
        try: () => realpath(rawPath),
        catch: (cause) =>
          toHostOperationError(cause, "settingsConfig.canonicalizePath", {
            path: rawPath,
          }),
      });
    },
    pathExists(inputPath) {
      return Effect.tryPromise({
        try: () => access(inputPath),
        catch: (cause) => toHostPathStatError(cause, "settingsConfig.pathExists", inputPath),
      }).pipe(
        Effect.as(true),
        Effect.catchTag("HostPathNotFoundError", () => Effect.succeed(false)),
      );
    },
    join(...paths) {
      return path.join(...paths);
    },
  };
};

export const SettingsConfigPortLive = Layer.succeed(
  SettingsConfigPortTag,
  createSettingsConfigAdapter(),
);
