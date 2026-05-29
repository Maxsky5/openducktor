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
import type { HostRuntimeDistribution } from "./runtime-distribution";

export type RuntimeBinaryPathOptions = {
  platform?: NodeJS.Platform;
  homeDir?: string;
};

export type CodexBinaryResolutionOptions = RuntimeBinaryPathOptions & {
  runtimeDistribution: HostRuntimeDistribution;
};

type RuntimeBinaryResolutionContext = {
  platform: NodeJS.Platform;
  homeDir: string;
};

type CodexBinaryResolutionContext = RuntimeBinaryResolutionContext & {
  runtimeDistribution: HostRuntimeDistribution;
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

const resolveBundledCommand = (command: string, options: CodexBinaryResolutionContext) =>
  Effect.gen(function* () {
    if (options.runtimeDistribution.mode !== "artifact") {
      return null;
    }
    const bundledBinDir = options.runtimeDistribution.bundledBinDir;
    if (bundledBinDir === undefined) {
      return null;
    }

    const candidate = joinRuntimePath(
      options.platform,
      resolveUserPath(bundledBinDir, options.homeDir),
      executableName(command, options.platform),
    );
    if (yield* isExecutableFile(candidate, options.platform)) {
      return candidate;
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
  options: RuntimeBinaryPathOptions,
): RuntimeBinaryResolutionContext => ({
  platform: options.platform ?? process.platform,
  homeDir: options.homeDir ?? homedir(),
});

export const resolveOpencodeBinary = (
  systemCommands: SystemCommandPort,
  env: NodeJS.ProcessEnv = process.env,
  options: RuntimeBinaryPathOptions = {},
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
  options: CodexBinaryResolutionOptions,
) =>
  Effect.gen(function* () {
    const context: CodexBinaryResolutionContext = {
      ...runtimeBinaryResolutionContext(options),
      runtimeDistribution: options.runtimeDistribution,
    };
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

    const bundled = yield* resolveBundledCommand("codex", context);
    if (bundled !== null) {
      return bundled;
    }

    const pathCommand = yield* resolvePathCommand("codex", systemCommands, env);
    if (pathCommand !== null) {
      return pathCommand;
    }

    const bundledLocation =
      context.runtimeDistribution.mode === "artifact" &&
      context.runtimeDistribution.bundledBinDir !== undefined
        ? joinRuntimePath(
            platform,
            resolveUserPath(context.runtimeDistribution.bundledBinDir, homeDir),
            executableName("codex", platform),
          )
        : "none configured";
    return yield* Effect.fail(
      new HostDependencyError({
        dependency: "codex",
        operation: "runtimeBinaries.resolveCodexBinary",
        message: `codex not found. Checked OPENDUCKTOR_CODEX_BINARY, bundled location (${bundledLocation}), and PATH. Install codex, fix PATH, or set OPENDUCKTOR_CODEX_BINARY.`,
      }),
    );
  });
