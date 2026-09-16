import { createHash } from "node:crypto";
import { access, type FileHandle, mkdir, open, readFile, realpath, rename } from "node:fs/promises";
import path from "node:path";
import type { GlobalConfig, PersistedGlobalConfigV2 } from "@openducktor/contracts";
import { Clock, Deferred, Effect, Exit, FiberId } from "effect";
import { z } from "zod";
import {
  type LoadedGlobalConfig,
  parsePersistedGlobalConfig,
  parsePersistedGlobalConfigV2,
  parsePersistedGlobalConfigV3,
  readPersistedGlobalConfigVersion,
  upgradePersistedGlobalConfigV2,
  upgradePersistedGlobalConfigV3,
} from "../../config/global-config";
import { configValidationMessage } from "../../config/config-validation-message";
import {
  displayUserPath,
  resolveOpenDucktorBaseDir,
  resolveUserPath,
} from "../../config/openducktor-config-dir";
import {
  errorMessage,
  HostOperationError,
  HostValidationError,
  toHostOperationError,
  toHostPathStatError,
} from "../../effect/host-errors";
import { parseJson } from "../../effect/json";
import type { SettingsConfigError, SettingsConfigPort } from "../../ports/settings-config-port";
import type { WorkspaceOwnershipLock } from "../../application/workspaces/workspace-ownership-lock";

const USER_SETTINGS_FILENAME = "config.json";
const missingConfigFileErrorSchema = z.object({ code: z.literal("ENOENT") }).passthrough();

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

const CONFIG_FILE_RECOVERY_HINT =
  "Fix the values in this file, or move it aside to reset OpenDucktor settings.";

const formatConfigFileProblem = (heading: string, problem: string): string =>
  [heading, problem, CONFIG_FILE_RECOVERY_HINT].join("\n\n");

const configFileProblem = (cause: unknown): string | null => {
  if (cause instanceof HostValidationError) {
    return cause.message;
  }
  if (cause instanceof z.ZodError) {
    return configValidationMessage(cause);
  }

  return null;
};

const invalidConfigFileError = (resolvedConfigPath: string, cause: unknown) => {
  const configPath = displayUserPath(resolvedConfigPath);
  const problem = configFileProblem(cause);
  if (problem === null) {
    return new HostOperationError({
      operation: "settingsConfig.parseConfig",
      message: formatConfigFileProblem(
        `Failed parsing config file ${configPath}:`,
        errorMessage(cause),
      ),
      cause,
      details: { path: resolvedConfigPath },
    });
  }

  return new HostValidationError({
    message: formatConfigFileProblem(`Invalid config file ${configPath}:`, problem),
    cause,
    details: { path: resolvedConfigPath },
  });
};

export type CreateSettingsConfigAdapterInput = {
  configDir?: string;
  configPath?: string;
  environment?: NodeJS.ProcessEnv;
  initializationLock?: WorkspaceOwnershipLock;
  initializeConfig?: (
    legacyConfig: PersistedGlobalConfigV2 | null,
  ) => Effect.Effect<LoadedGlobalConfig, SettingsConfigError>;
};

type SettingsInitializationFlight = Deferred.Deferred<LoadedGlobalConfig, SettingsConfigError>;

type PersistedConfigState =
  | { readonly _tag: "missing" }
  | { readonly _tag: "current"; readonly config: LoadedGlobalConfig }
  | { readonly _tag: "legacy"; readonly config: PersistedGlobalConfigV2 };

const makeSettingsInitializationFlight = (): SettingsInitializationFlight =>
  Deferred.unsafeMake(FiberId.none);

const withFileHandle = <A>(
  acquire: () => Promise<FileHandle>,
  use: (handle: FileHandle) => Promise<A>,
) =>
  Effect.gen(function* () {
    const handle = yield* Effect.tryPromise(acquire);
    const useExit = yield* Effect.exit(Effect.tryPromise(() => use(handle)));
    const closeExit = yield* Effect.exit(Effect.tryPromise(() => handle.close()));
    return yield* Exit.zipLeft(useExit, closeExit);
  });

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
      yield* withFileHandle(
        () => open(tempPath, "w", 0o600),
        async (handle) => {
          await handle.writeFile(payload);
          await handle.sync();
        },
      );
      yield* Effect.tryPromise(() => rename(tempPath, resolvedConfigPath));
      if (process.platform !== "win32") {
        yield* withFileHandle(
          () => open(baseDir, "r"),
          (handle) => handle.sync(),
        );
      }
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
  configDir,
  configPath,
  environment,
  initializationLock,
  initializeConfig,
}: CreateSettingsConfigAdapterInput = {}): SettingsConfigPort => {
  const resolvedConfigPath =
    configPath ??
    path.join(
      configDir ?? resolveOpenDucktorBaseDir("production", environment),
      USER_SETTINGS_FILENAME,
    );
  const baseDir = path.dirname(resolvedConfigPath);
  let initializationFlight: SettingsInitializationFlight | null = null;

  const readPersistedConfig = (): Effect.Effect<PersistedConfigState, SettingsConfigError> =>
    Effect.gen(function* () {
      const payload = yield* Effect.tryPromise({
        try: () => readFile(resolvedConfigPath, "utf8"),
        catch: (cause) =>
          toHostOperationError(cause, "settingsConfig.readConfig", { path: resolvedConfigPath }),
      }).pipe(
        Effect.catchTag("HostOperationError", (error) => {
          if (missingConfigFileErrorSchema.safeParse(error.cause).success) {
            return Effect.succeed(null);
          }

          return Effect.fail(error);
        }),
      );
      if (payload === null) {
        return { _tag: "missing" } as const;
      }

      const parsedPayload = yield* Effect.try({
        try: () => parseJson(payload),
        catch: (cause) => invalidConfigFileError(resolvedConfigPath, cause),
      });
      const version = yield* Effect.try({
        try: () => readPersistedGlobalConfigVersion(parsedPayload),
        catch: (cause) => invalidConfigFileError(resolvedConfigPath, cause),
      });
      if (version === 4) {
        const config = yield* Effect.try({
          try: () => parsePersistedGlobalConfig(parsedPayload),
          catch: (cause) => invalidConfigFileError(resolvedConfigPath, cause),
        });
        return { _tag: "current", config } as const;
      }
      if (version === 3) {
        const config = yield* Effect.try({
          try: () => upgradePersistedGlobalConfigV3(parsePersistedGlobalConfigV3(parsedPayload)),
          catch: (cause) => invalidConfigFileError(resolvedConfigPath, cause),
        });
        return { _tag: "current", config } as const;
      }

      const config = yield* Effect.try({
        try: () => parsePersistedGlobalConfigV2(parsedPayload),
        catch: (cause) => invalidConfigFileError(resolvedConfigPath, cause),
      });
      return { _tag: "legacy", config } as const;
    });

  const completeInitialization = (
    flight: SettingsInitializationFlight,
    initializer: NonNullable<CreateSettingsConfigAdapterInput["initializeConfig"]>,
  ) => {
    const initialize = Effect.gen(function* () {
      const persisted = yield* readPersistedConfig();
      if (persisted._tag === "current") {
        return persisted.config;
      }
      const config = yield* initializer(persisted._tag === "legacy" ? persisted.config : null);
      yield* persistGlobalConfig(resolvedConfigPath, baseDir, config);
      return config;
    });
    const guardedInitialization = initializationLock
      ? initializationLock.runExclusive(initialize)
      : initialize;

    return Effect.gen(function* () {
      const exit = yield* Effect.exit(guardedInitialization);
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
  };

  const initializeOnce = () => {
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
          yield* Effect.forkDaemon(completeInitialization(reservation.flight, initializer));
        }
        return yield* restore(Deferred.await(reservation.flight));
      }),
    );
  };

  return {
    readConfig(options) {
      const initialize = options?.initialize ?? true;
      return Effect.gen(function* () {
        const persisted = yield* readPersistedConfig();
        if (persisted._tag === "current") {
          return persisted.config;
        }

        if (!initialize) {
          return persisted._tag === "legacy"
            ? upgradePersistedGlobalConfigV2(persisted.config, {})
            : null;
        }

        return initializeConfig ? yield* initializeOnce() : null;
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
