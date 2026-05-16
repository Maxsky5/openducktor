import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SystemCommandPort } from "../../ports/system-command-port";

const BUNDLED_BIN_DIR_ENV = "OPENDUCKTOR_BUNDLED_BIN_DIR";

export type RuntimeBinaryResolutionOptions = {
  platform?: NodeJS.Platform;
  homeDir?: string;
  resourcesPath?: string | null;
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

export const isExecutableFile = async (
  candidate: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> => {
  try {
    if (platform === "win32") {
      const file = await stat(candidate);
      return file.isFile();
    }

    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const executableName = (command: string, platform: NodeJS.Platform): string =>
  platform === "win32" ? `${command}.exe` : command;

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

const resolveBundledCommand = async (
  command: string,
  env: NodeJS.ProcessEnv,
  options: {
    platform: NodeJS.Platform;
    homeDir: string;
    resourcesPath: string | null | undefined;
  },
): Promise<string | null> => {
  const configuredBinDir = env[BUNDLED_BIN_DIR_ENV];
  if (configuredBinDir !== undefined && configuredBinDir.trim().length === 0) {
    throw new Error(`Configured bundled binary directory ${BUNDLED_BIN_DIR_ENV} is empty`);
  }
  const resourcesPath = processResourcesPath(options.resourcesPath);
  const candidateDirs = [
    ...(configuredBinDir && configuredBinDir.trim().length > 0
      ? [resolveUserPath(configuredBinDir, options.homeDir)]
      : []),
    ...(resourcesPath ? [join(resourcesPath, "bin")] : []),
  ];

  for (const directory of candidateDirs) {
    const candidate = join(directory, executableName(command, options.platform));
    if (await isExecutableFile(candidate, options.platform)) {
      return candidate;
    }
  }

  return null;
};

const resolvePathCommand = async (
  command: string,
  systemCommands: SystemCommandPort,
  env: NodeJS.ProcessEnv,
): Promise<string | null> => {
  const resolved = await systemCommands.resolveCommandPath?.(command, env);
  if (resolved !== undefined) {
    return resolved;
  }

  return (await systemCommands.requiredCommandError(command)) === null ? command : null;
};

export const resolveOpencodeBinary = async (
  systemCommands: SystemCommandPort,
  env: NodeJS.ProcessEnv = process.env,
  options: RuntimeBinaryResolutionOptions = {},
): Promise<string> => {
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? homedir();
  const overrideBinary = env.OPENDUCKTOR_OPENCODE_BINARY;
  if (overrideBinary !== undefined) {
    if (overrideBinary.trim().length === 0) {
      throw new Error("Configured OpenCode override OPENDUCKTOR_OPENCODE_BINARY is empty");
    }
    const resolvedOverride = resolveUserPath(overrideBinary, homeDir);
    if (await isExecutableFile(resolvedOverride, platform)) {
      return resolvedOverride;
    }
    throw new Error(
      `Configured OpenCode override OPENDUCKTOR_OPENCODE_BINARY points to a missing or non-executable file: ${resolvedOverride}`,
    );
  }

  const homeCandidate = join(
    homeDir,
    ".opencode",
    "bin",
    platform === "win32" ? "opencode.exe" : "opencode",
  );
  if (await isExecutableFile(homeCandidate, platform)) {
    return homeCandidate;
  }

  const pathCommand = await resolvePathCommand("opencode", systemCommands, env);
  if (pathCommand !== null) {
    return pathCommand;
  }

  throw new Error(
    `opencode not found. Checked OPENDUCKTOR_OPENCODE_BINARY, standard install location ${homeCandidate}, and PATH. Install opencode or set OPENDUCKTOR_OPENCODE_BINARY.`,
  );
};

export const resolveCodexBinary = async (
  systemCommands: SystemCommandPort,
  env: NodeJS.ProcessEnv = process.env,
  options: RuntimeBinaryResolutionOptions = {},
): Promise<string> => {
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? homedir();
  const overrideBinary = env.OPENDUCKTOR_CODEX_BINARY;
  if (overrideBinary !== undefined) {
    if (overrideBinary.trim().length === 0) {
      throw new Error("Configured Codex override OPENDUCKTOR_CODEX_BINARY is empty");
    }
    const resolvedOverride = resolveUserPath(overrideBinary, homeDir);
    if (await isExecutableFile(resolvedOverride, platform)) {
      return resolvedOverride;
    }
    throw new Error(
      `Configured Codex override OPENDUCKTOR_CODEX_BINARY points to a missing or non-executable file: ${resolvedOverride}`,
    );
  }

  const bundled = await resolveBundledCommand("codex", env, {
    platform,
    homeDir,
    resourcesPath: options.resourcesPath,
  });
  if (bundled !== null) {
    return bundled;
  }

  const pathCommand = await resolvePathCommand("codex", systemCommands, env);
  if (pathCommand !== null) {
    return pathCommand;
  }

  const resourcesPath = processResourcesPath(options.resourcesPath);
  const bundledLocations = [
    `${BUNDLED_BIN_DIR_ENV}`,
    ...(resourcesPath ? [join(resourcesPath, "bin", executableName("codex", platform))] : []),
  ].join(", ");
  throw new Error(
    `codex not found. Checked OPENDUCKTOR_CODEX_BINARY, bundled locations (${bundledLocations}), and PATH. Install codex, fix PATH, or set OPENDUCKTOR_CODEX_BINARY.`,
  );
};
