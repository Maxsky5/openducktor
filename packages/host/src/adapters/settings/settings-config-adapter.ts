import { createHash } from "node:crypto";
import { access, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GlobalConfig } from "@openducktor/contracts";
import { Clock, Effect, Layer } from "effect";
import { parsePersistedGlobalConfig } from "../../config/global-config";
import { resolveOpenDucktorBaseDir, resolveUserPath } from "../../config/openducktor-config-dir";
import {
  HostOperationError,
  HostValidationError,
  toHostOperationError,
  toHostPathStatError,
} from "../../effect/host-errors";
import { parseJson } from "../../effect/json";
import { type SettingsConfigPort, SettingsConfigPortTag } from "../../ports/settings-config-port";

const USER_SETTINGS_FILENAME = "config.json";

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
          try: () => parsePersistedGlobalConfig(parseJson(payload)),
          catch: (cause) =>
            cause instanceof HostValidationError
              ? new HostValidationError({
                  message: `Invalid config file ${resolvedConfigPath}: ${cause.message}`,
                  cause,
                  details: { path: resolvedConfigPath },
                })
              : toHostOperationError(cause, "settingsConfig.parseConfig", {
                  path: resolvedConfigPath,
                }),
        }).pipe(
          Effect.mapError((error) =>
            error instanceof HostValidationError
              ? error
              : new HostOperationError({
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
          try: () => mkdir(baseDir, { recursive: true }),
          catch: (cause) =>
            toHostOperationError(cause, "settingsConfig.createConfigDirectory", {
              path: baseDir,
            }),
        }).pipe(
          Effect.asVoid,
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

        const now = yield* Clock.currentTimeMillis;
        const tempPath = path.join(
          baseDir,
          `.${path.basename(resolvedConfigPath)}.tmp-${process.pid}-${now}`,
        );
        const payload = `${JSON.stringify(config, null, 2)}\n`;

        yield* Effect.gen(function* () {
          yield* Effect.tryPromise(() => writeFile(tempPath, payload, { mode: 0o600 }));
          yield* Effect.tryPromise(() => rename(tempPath, resolvedConfigPath));
        }).pipe(
          Effect.mapError((cause) =>
            toHostOperationError(cause, "settingsConfig.writeConfig", {
              path: resolvedConfigPath,
              tempPath,
            }),
          ),
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
