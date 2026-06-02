import { homedir } from "node:os";
import path from "node:path";
import { normalizeUserPathInput, resolveNormalizedUserPath } from "@openducktor/path-support";
import { HostResourceError, HostValidationError } from "../effect/host-errors";

const OPENDUCKTOR_CONFIG_DIR_ENV = "OPENDUCKTOR_CONFIG_DIR";
const DEFAULT_CONFIG_DIR_NAME = ".openducktor";

const resolveHomeDirectory = (): string => {
  const home = homedir();
  if (home.trim().length > 0) {
    return home;
  }

  throw new HostResourceError({
    message: "Unable to resolve user home directory",
    resource: "user-home-directory",
    operation: "openducktor.resolve-config-dir",
  });
};

export const resolveUserPath = (rawPath: string): string => {
  const normalized = normalizeUserPathInput(rawPath);
  if (!normalized) {
    throw new HostValidationError({
      message: "Path is empty; provide a valid path",
      field: "path",
    });
  }

  return resolveNormalizedUserPath(normalized, {
    resolveHomeDir: resolveHomeDirectory,
    joinHomePath: (homeDir, relativePath) => path.join(homeDir, relativePath),
  });
};

const resolveConfiguredBaseDir = (rawPath: string): string => {
  const normalized = normalizeUserPathInput(rawPath);
  if (!normalized) {
    throw new HostValidationError({
      message: "OPENDUCKTOR_CONFIG_DIR is set but empty; provide a valid directory path",
      field: OPENDUCKTOR_CONFIG_DIR_ENV,
    });
  }

  return resolveNormalizedUserPath(normalized, {
    resolveHomeDir: resolveHomeDirectory,
    joinHomePath: (homeDir, relativePath) => path.join(homeDir, relativePath),
  });
};

export const resolveOpenDucktorBaseDir = (env: NodeJS.ProcessEnv = process.env): string => {
  const envDir = env[OPENDUCKTOR_CONFIG_DIR_ENV];
  if (envDir !== undefined) {
    return resolveConfiguredBaseDir(envDir);
  }

  return path.join(resolveHomeDirectory(), DEFAULT_CONFIG_DIR_NAME);
};
