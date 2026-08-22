import { hasRuntimeType } from "@openducktor/contracts";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GlobalConfig, JsonValue, PersistedGlobalConfigV2 } from "@openducktor/contracts";
import { Clock, Deferred, Effect, FiberId } from "effect";
import {
  type LoadedGlobalConfig,
  parsePersistedGlobalConfig,
  parsePersistedGlobalConfigV2,
  readPersistedGlobalConfigVersion,
} from "../../config/global-config";
import { resolveOpenDucktorBaseDir, resolveUserPath } from "../../config/openducktor-config-dir";
import {
  HostOperationError,
  HostValidationError,
  toHostOperationError,
  toHostPathStatError,
} from "../../effect/host-errors";
import { parseJson } from "../../effect/json";
import type { SettingsConfigError, SettingsConfigPort } from "../../ports/settings-config-port";

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
  environment?: NodeJS.ProcessEnv;
  initializeConfig?: (
    legacyConfig: PersistedGlobalConfigV2 | null,
  ) => Effect.Effect<LoadedGlobalConfig, SettingsConfigError>;
};

type SettingsInitializationFlight = Deferred.Deferred<LoadedGlobalConfig, SettingsConfigError>;

const makeSettingsInitializationFlight = (): SettingsInitializationFlight =>
  Deferred.unsafeMake(FiberId.none);

const persistGlobalConfig = (resolvedConfigPath: string, baseDir: string, config: GlobalConfig) =>
  Effect.gen(function* () {
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

export const createSettingsConfigAdapter = ({
  configPath,
  environment,
  initializeConfig,
}: CreateSettingsConfigAdapterInput = {}): SettingsConfigPort => {
  const resolvedConfigPath =
    configPath ?? path.join(resolveOpenDucktorBaseDir(environment), USER_SETTINGS_FILENAME);
  const baseDir = path.dirname(resolvedConfigPath);
  let initializationFlight: SettingsInitializationFlight | null = null;

  const completeInitialization = (
    legacyConfig: PersistedGlobalConfigV2 | null,
    flight: SettingsInitializationFlight,
    initializer: NonNullable<CreateSettingsConfigAdapterInput["initializeConfig"]>,
  ) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        initializer(legacyConfig).pipe(
          Effect.tap((config) => persistGlobalConfig(resolvedConfigPath, baseDir, config)),
        ),
      );
      yield* Deferred.done(flight, exit);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (initializationFlight === flight) {
            initializationFlight = null;
          }
        }),
      ),
    );

  const initializeOnce = (legacyConfig: PersistedGlobalConfigV2 | null) => {
    if (!initializeConfig) {
      return Effect.fail(
        new HostValidationError({
          message: `Config file ${resolvedConfigPath} requires runtime path initialization.`,
          details: { path: resolvedConfigPath },
        }),
      );
    }
    const initializer = initializeConfig;
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const reservation = yield* Effect.sync(() => {
          if (initializationFlight) {
            return { created: false as const, flight: initializationFlight };
          }
          const flight = makeSettingsInitializationFlight();
          initializationFlight = flight;
          return { created: true as const, flight };
        });
        if (reservation.created) {
          yield* Effect.forkDaemon(
            completeInitialization(legacyConfig, reservation.flight, initializer),
          );
        }
        return yield* restore(Deferred.await(reservation.flight));
      }),
    );
  };

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
              hasRuntimeType(error.cause, "object") &&
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
          return initializeConfig ? yield* initializeOnce(null) : null;
        }

        const parsedPayload = yield* Effect.try({
          try: () => parseJson(payload),
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
        // SAFETY: JSON.parse only produces JSON-compatible values.
        const parsedJsonPayload = parsedPayload as JsonValue;
        const version = yield* Effect.try({
          try: () => readPersistedGlobalConfigVersion(parsedJsonPayload),
          catch: (cause) =>
            cause instanceof HostValidationError
              ? new HostValidationError({
                  message: `Invalid config file ${resolvedConfigPath}: ${cause.message}`,
                  cause,
                  details: { path: resolvedConfigPath },
                })
              : toHostOperationError(cause, "settingsConfig.readConfigVersion", {
                  path: resolvedConfigPath,
                }),
        });
        if (version === 3) {
          return yield* Effect.try({
            try: () => parsePersistedGlobalConfig(parsedJsonPayload),
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
          });
        }

        const legacyConfig = yield* Effect.try({
          try: () => parsePersistedGlobalConfigV2(parsedJsonPayload),
          catch: (cause) =>
            cause instanceof HostValidationError
              ? new HostValidationError({
                  message: `Invalid config file ${resolvedConfigPath}: ${cause.message}`,
                  cause,
                  details: { path: resolvedConfigPath },
                })
              : toHostOperationError(cause, "settingsConfig.parseLegacyConfig", {
                  path: resolvedConfigPath,
                }),
        });
        return yield* initializeOnce(legacyConfig);
      });
    },
    writeConfig(config: GlobalConfig) {
      return persistGlobalConfig(resolvedConfigPath, baseDir, config);
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
