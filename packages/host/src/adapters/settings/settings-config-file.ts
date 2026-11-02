import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GlobalConfig, PersistedGlobalConfigV2 } from "@openducktor/contracts";
import { Clock, Effect } from "effect";
import { z } from "zod";
import {
  type HostPreferences,
  hostPreferencesSchema,
  parseHostPreferences,
  parsePersistedGlobalConfig,
  parsePersistedGlobalConfigV2,
  parsePersistedGlobalConfigV3,
  readPersistedGlobalConfigVersion,
  upgradePersistedGlobalConfigV3,
} from "../../config/global-config";
import { configValidationMessage } from "../../config/config-validation-message";
import { displayUserPath } from "../../config/openducktor-config-dir";
import {
  errorMessage,
  HostOperationError,
  HostValidationError,
  type HostOperationErrorAggregate,
  isPathNotFoundError,
  SettingsFileError,
  toHostOperationError,
} from "../../effect/host-errors";
import { parseJson } from "../../effect/json";
import type { SettingsConfigError } from "../../ports/settings-config-port";

/** Run after the database import commits, under the host database write lock. */
export const migrateSettingsConfig = (configPath: string) => {
  const backupPath = `${configPath}.backup`;
  return Effect.gen(function* () {
    const text = yield* readSettingsText(configPath);
    const payload = text === undefined ? undefined : yield* parseSettingsJson(configPath, text);
    const preferences = yield* Effect.try({
      try: () => parseHostPreferences(payload ?? { version: 5 }),
      catch: (cause) => invalidFileError(configPath, cause),
    });
    if (preferencesVersionSchema.safeParse(payload).success) return;
    if (text !== undefined) {
      const backupText = yield* readBackupText(backupPath);
      if (backupText === undefined) yield* writeSettingsFile(backupPath, text);
      else if (backupText !== text) return yield* backupConflictError(configPath, backupPath);
    }
    yield* writePreferences(configPath, preferences);
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof SettingsFileError && cause.reason === "backupConflict"
        ? cause
        : new HostOperationError({
            operation: "settingsConfig.migratePreferences",
            message: `Cannot finish settings migration for ${configPath}. Keep this file and any ${backupPath}, correct the file error, then restart. ${cause.message}`,
            cause,
            details: { path: configPath, backupPath },
          }),
    ),
  );
};

const backupConflictError = (configPath: string, backupPath: string) =>
  new SettingsFileError({
    reason: "backupConflict",
    path: configPath,
    backupPath,
    message: `Config file ${configPath} holds settings from an older OpenDucktor version that the host database does not contain. ${backupPath} already holds different settings, so OpenDucktor cannot back up this file. Keep the settings that you need from the two files, move one of them aside, then restart.`,
  });

const readBackupText = (backupPath: string) =>
  Effect.gen(function* () {
    const backup = yield* Effect.tryPromise({
      try: () => stat(backupPath),
      catch: (cause) =>
        toHostOperationError(cause, "settingsConfig.statBackup", { path: backupPath }),
    }).pipe(
      Effect.catchTag("HostOperationError", (error) =>
        isPathNotFoundError(error.cause) ? Effect.succeed(undefined) : Effect.fail(error),
      ),
    );
    if (backup === undefined) return undefined;
    if (!backup.isFile())
      return yield* new HostOperationError({
        operation: "settingsConfig.statBackup",
        message: `Settings backup path ${backupPath} is not a file. Move it aside, then restart.`,
        details: { path: backupPath },
      });
    return yield* Effect.tryPromise({
      try: () => readFile(backupPath, "utf8"),
      catch: (cause) =>
        toHostOperationError(cause, "settingsConfig.readBackup", { path: backupPath }),
    });
  });

export const writePreferences = (configPath: string, preferences: HostPreferences) =>
  writeSettingsFile(configPath, `${JSON.stringify(preferences, null, 2)}\n`);

export const loadLegacySettingsConfig = (
  configPath: string,
  initializeConfig: (
    legacyConfig: PersistedGlobalConfigV2 | null,
  ) => Effect.Effect<GlobalConfig, SettingsConfigError>,
): Effect.Effect<GlobalConfig, SettingsConfigError> =>
  readSettingsConfigFile(configPath).pipe(
    Effect.flatMap((config) => {
      if (config === null || config.version === 2) return initializeConfig(config);
      if (config.version === 5)
        return Effect.fail(
          new SettingsFileError({
            reason: "databaseMissing",
            path: configPath,
            message: `Config file ${configPath} contains preferences only, but the host database is missing or incomplete. Restore database.sqlite from a compatible backup before starting the host.`,
          }),
        );
      return Effect.succeed(config);
    }),
  );

export const readHostPreferences = (configPath: string) =>
  readSettingsJson(configPath).pipe(
    Effect.flatMap((payload) =>
      Effect.try({
        try: () =>
          payload === undefined
            ? hostPreferencesSchema.parse({ version: 5 })
            : parseHostPreferences(payload),
        catch: (cause) => invalidFileError(configPath, cause),
      }),
    ),
  );

export const readSettingsConfigFile = (
  configPath: string,
): Effect.Effect<
  GlobalConfig | PersistedGlobalConfigV2 | HostPreferences | null,
  SettingsConfigError
> =>
  readSettingsJson(configPath).pipe(
    Effect.flatMap((payload) =>
      Effect.try({
        try: () => {
          if (payload === undefined) return null;
          if (preferencesVersionSchema.safeParse(payload).success)
            return parseHostPreferences(payload);
          const version = readPersistedGlobalConfigVersion(payload);
          if (version === 4) return parsePersistedGlobalConfig(payload);
          if (version === 3)
            return upgradePersistedGlobalConfigV3(parsePersistedGlobalConfigV3(payload));
          return parsePersistedGlobalConfigV2(payload);
        },
        catch: (cause) => invalidFileError(configPath, cause),
      }),
    ),
  );

const writeSettingsFile = (
  configPath: string,
  payload: string,
): Effect.Effect<void, HostOperationErrorAggregate> =>
  Effect.gen(function* () {
    const baseDir = path.dirname(configPath);
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
    const tempPath = path.join(baseDir, `.${path.basename(configPath)}.tmp-${process.pid}-${now}`);

    yield* Effect.gen(function* () {
      yield* Effect.tryPromise(() => writeFile(tempPath, payload, { mode: 0o600 }));
      yield* Effect.tryPromise(() => rename(tempPath, configPath));
    }).pipe(
      Effect.mapError((cause) =>
        toHostOperationError(cause, "settingsConfig.writePreferences", {
          path: configPath,
          tempPath,
        }),
      ),
      Effect.mapError(
        (error) =>
          new HostOperationError({
            operation: "settingsConfig.writePreferences",
            message: `Failed writing config file ${configPath}: ${error.message}`,
            cause: error,
            details: { path: configPath, tempPath },
          }),
      ),
    );
  });

const preferencesVersionSchema = z.object({ version: z.literal(5) });

const RECOVERY_HINT =
  "Fix the values in this file, or move it aside to reset OpenDucktor settings.";

const formatFileProblem = (heading: string, problem: string): string =>
  [heading, problem, RECOVERY_HINT].join("\n\n");

const fileProblem = (cause: unknown): string | null => {
  if (cause instanceof SyntaxError) {
    return `Invalid JSON: ${cause.message}`;
  }
  if (cause instanceof HostValidationError) {
    return cause.message;
  }
  if (cause instanceof z.ZodError) {
    return configValidationMessage(cause);
  }

  return null;
};

const invalidFileError = (resolvedConfigPath: string, cause: unknown) => {
  const configPath = displayUserPath(resolvedConfigPath);
  const problem = fileProblem(cause);
  if (problem === null) {
    return new HostOperationError({
      operation: "settingsConfig.parseConfig",
      message: formatFileProblem(`Failed parsing config file ${configPath}:`, errorMessage(cause)),
      cause,
      details: { path: resolvedConfigPath },
    });
  }

  return new SettingsFileError({
    reason: "invalid",
    path: resolvedConfigPath,
    message: formatFileProblem(`Invalid config file ${configPath}:`, problem),
    cause,
  });
};

const readSettingsText = (configPath: string) =>
  Effect.tryPromise({
    try: () => readFile(configPath, "utf8"),
    catch: (cause) =>
      toHostOperationError(cause, "settingsConfig.readConfig", { path: configPath }),
  }).pipe(
    Effect.catchTag("HostOperationError", (error) =>
      isPathNotFoundError(error.cause) ? Effect.succeed(undefined) : Effect.fail(error),
    ),
  );

const parseSettingsJson = (configPath: string, text: string) =>
  Effect.try({
    try: () => parseJson(text),
    catch: (cause) => invalidFileError(configPath, cause),
  });

const readSettingsJson = (configPath: string) =>
  readSettingsText(configPath).pipe(
    Effect.flatMap((text) =>
      text === undefined ? Effect.succeed(undefined) : parseSettingsJson(configPath, text),
    ),
  );
