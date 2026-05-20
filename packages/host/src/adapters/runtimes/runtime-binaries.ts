import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, posix } from "node:path";
import { Effect } from "effect";
import {
  HostDependencyError,
  HostValidationError,
  toHostPathStatError,
} from "../../effect/host-errors";
import type { SystemCommandPort } from "../../ports/system-command-port";

const BUNDLED_BIN_DIR_ENV = "OPENDUCKTOR_BUNDLED_BIN_DIR";

export type RuntimeBinaryResolutionOptions = {
  platform?: NodeJS.Platform;
  homeDir?: string;
  resourcesPath?: string | null;
};

type RuntimeBinaryResolutionContext = {
  platform: NodeJS.Platform;
  homeDir: string;
  resourcesPath: string | null | undefined;
};

const stripMatchingQuotes = (value: string): string => {
  if (value.length < 2) {
    return value;
  }
  const first = value.at(0);
  const last = value.at(-1);
  return (first === `"` && last === `"`) || (first === `'` && last === `'`)
    ? value.slice(1, -1)
    : value;
};

export const resolveUserPath = (rawPath: string, homeDir = homedir()): string => {
  const trimmed = stripMatchingQuotes(rawPath.trim());
  if (trimmed === "~") {
    return homeDir;
  }
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return join(homeDir, trimmed.slice(2));
  }
  return trimmed;
};

export const isExecutableFile = (candidate: string, platform: NodeJS.Platform = process.platform) =>
  Effect.gen(function* () {
    const file = yield* Effect.tryPromise({
      try: () => stat(candidate),
      catch: (cause) => toHostPathStatError(cause, "runtimeBinaries.isExecutableFile", candidate),
    });
    if (!file.isFile()) {
      return false;
    }
    if (platform === "win32") {
      return true;
    }

    yield* Effect.tryPromise({
      try: () => access(candidate, constants.X_OK),
      catch: (cause) => toHostPathStatError(cause, "runtimeBinaries.isExecutableFile", candidate),
    });
    return true;
  }).pipe(
    Effect.catchTags({
      HostPathAccessError: () => Effect.succeed(false),
      HostPathNotFoundError: () => Effect.succeed(false),
    }),
  );

const executableName = (command: string, platform: NodeJS.Platform): string =>
  platform === "win32" ? `${command}.exe` : command;

const joinRuntimePath = (platform: NodeJS.Platform, ...segments: string[]): string => {
  if (platform === "win32") {
    return join(...segments);
  }
  return posix.join(...segments);
};

const processResourcesPath = (configuredResourcesPath?: string | null): string | null => {
  if (configuredResourcesPath !== undefined) {
    return typeof configuredResourcesPath === "string" && configuredResourcesPath.trim().length > 0
      ? configuredResourcesPath
      : null;
  }
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return typeof resourcesPath === "string" && resourcesPath.trim().length > 0
    ? resourcesPath
    : null;
};

const resolveBundledCommand = (
  command: string,
  env: NodeJS.ProcessEnv,
  options: RuntimeBinaryResolutionContext,
) =>
  Effect.gen(function* () {
    const configuredBinDir = env[BUNDLED_BIN_DIR_ENV];
    if (configuredBinDir !== undefined && configuredBinDir.trim().length === 0) {
      return yield* Effect.fail(
        new HostValidationError({
          field: BUNDLED_BIN_DIR_ENV,
          message: `Configured bundled binary directory ${BUNDLED_BIN_DIR_ENV} is empty`,
        }),
      );
    }

    const resourcesPath = processResourcesPath(options.resourcesPath);
    const candidateDirs: Array<{ directory: string; joinPlatform: NodeJS.Platform }> = [
      ...(configuredBinDir && configuredBinDir.trim().length > 0
        ? [
            {
              directory: resolveUserPath(configuredBinDir, options.homeDir),
              joinPlatform: process.platform,
            },
          ]
        : []),
      ...(resourcesPath
        ? [
            {
              directory: joinRuntimePath(options.platform, resourcesPath, "bin"),
              joinPlatform: options.platform,
            },
          ]
        : []),
    ];

    for (const { directory, joinPlatform } of candidateDirs) {
      const candidate = joinRuntimePath(
        joinPlatform,
        directory,
        executableName(command, options.platform),
      );
      if (yield* isExecutableFile(candidate, options.platform)) {
        return candidate;
      }
    }

    return null;
  });

const resolvePathCommand = (
  command: string,
  systemCommands: SystemCommandPort,
  env: NodeJS.ProcessEnv,
) =>
  Effect.gen(function* () {
    const resolveCommandPathEffect = systemCommands.resolveCommandPath?.(command, env);
    if (resolveCommandPathEffect !== undefined) {
      return yield* resolveCommandPathEffect;
    }

    return (yield* systemCommands.requiredCommandError(command)) === null ? command : null;
  });

const runtimeBinaryResolutionContext = (
  options: RuntimeBinaryResolutionOptions,
): RuntimeBinaryResolutionContext => ({
  platform: options.platform ?? process.platform,
  homeDir: options.homeDir ?? homedir(),
  resourcesPath: options.resourcesPath,
});

export const resolveOpencodeBinary = (
  systemCommands: SystemCommandPort,
  env: NodeJS.ProcessEnv = process.env,
  options: RuntimeBinaryResolutionOptions = {},
) =>
  Effect.gen(function* () {
    const { platform, homeDir } = runtimeBinaryResolutionContext(options);
    const overrideBinary = env.OPENDUCKTOR_OPENCODE_BINARY;
    if (overrideBinary !== undefined) {
      if (overrideBinary.trim().length === 0) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "OPENDUCKTOR_OPENCODE_BINARY",
            message: "Configured OpenCode override OPENDUCKTOR_OPENCODE_BINARY is empty",
          }),
        );
      }
      const resolvedOverride = resolveUserPath(overrideBinary, homeDir);
      if (yield* isExecutableFile(resolvedOverride, platform)) {
        return resolvedOverride;
      }
      return yield* Effect.fail(
        new HostValidationError({
          field: "OPENDUCKTOR_OPENCODE_BINARY",
          message: `Configured OpenCode override OPENDUCKTOR_OPENCODE_BINARY points to a missing or non-executable file: ${resolvedOverride}`,
          details: { resolvedOverride },
        }),
      );
    }

    const homeCandidate = joinRuntimePath(
      platform,
      homeDir,
      ".opencode",
      "bin",
      executableName("opencode", platform),
    );
    if (yield* isExecutableFile(homeCandidate, platform)) {
      return homeCandidate;
    }

    const pathCommand = yield* resolvePathCommand("opencode", systemCommands, env);
    if (pathCommand !== null) {
      return pathCommand;
    }

    return yield* Effect.fail(
      new HostDependencyError({
        dependency: "opencode",
        operation: "runtimeBinaries.resolveOpencodeBinary",
        message: `opencode not found. Checked OPENDUCKTOR_OPENCODE_BINARY, standard install location ${homeCandidate}, and PATH. Install opencode or set OPENDUCKTOR_OPENCODE_BINARY.`,
      }),
    );
  });

export const resolveCodexBinary = (
  systemCommands: SystemCommandPort,
  env: NodeJS.ProcessEnv = process.env,
  options: RuntimeBinaryResolutionOptions = {},
) =>
  Effect.gen(function* () {
    const context = runtimeBinaryResolutionContext(options);
    const { platform, homeDir } = context;
    const overrideBinary = env.OPENDUCKTOR_CODEX_BINARY;
    if (overrideBinary !== undefined) {
      if (overrideBinary.trim().length === 0) {
        return yield* Effect.fail(
          new HostValidationError({
            field: "OPENDUCKTOR_CODEX_BINARY",
            message: "Configured Codex override OPENDUCKTOR_CODEX_BINARY is empty",
          }),
        );
      }
      const resolvedOverride = resolveUserPath(overrideBinary, homeDir);
      if (yield* isExecutableFile(resolvedOverride, platform)) {
        return resolvedOverride;
      }
      return yield* Effect.fail(
        new HostValidationError({
          field: "OPENDUCKTOR_CODEX_BINARY",
          message: `Configured Codex override OPENDUCKTOR_CODEX_BINARY points to a missing or non-executable file: ${resolvedOverride}`,
          details: { resolvedOverride },
        }),
      );
    }

    const bundled = yield* resolveBundledCommand("codex", env, context);
    if (bundled !== null) {
      return bundled;
    }

    const pathCommand = yield* resolvePathCommand("codex", systemCommands, env);
    if (pathCommand !== null) {
      return pathCommand;
    }

    const resourcesPath = processResourcesPath(context.resourcesPath);
    const bundledLocations = [
      `${BUNDLED_BIN_DIR_ENV}`,
      ...(resourcesPath
        ? [joinRuntimePath(platform, resourcesPath, "bin", executableName("codex", platform))]
        : []),
    ].join(", ");
    return yield* Effect.fail(
      new HostDependencyError({
        dependency: "codex",
        operation: "runtimeBinaries.resolveCodexBinary",
        message: `codex not found. Checked OPENDUCKTOR_CODEX_BINARY, bundled locations (${bundledLocations}), and PATH. Install codex, fix PATH, or set OPENDUCKTOR_CODEX_BINARY.`,
      }),
    );
  });
