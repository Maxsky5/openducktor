import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { OPENDUCKTOR_CONFIG_DIR_NAMES } from "@openducktor/contracts";
import { normalizeUserPathInput, resolveNormalizedUserPath } from "@openducktor/path-support";
import { HostResourceError, HostValidationError } from "../effect/host-errors";

const OPENDUCKTOR_CONFIG_DIR_ENV = "OPENDUCKTOR_CONFIG_DIR";

export type OpenDucktorConfigDirScope = "dev" | "production" | "test";

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

export const resolveOpenDucktorBaseDir = (
  scope: OpenDucktorConfigDirScope,
  env: NodeJS.ProcessEnv = process.env,
): string => {
  const envDir = env[OPENDUCKTOR_CONFIG_DIR_ENV];
  if (envDir !== undefined) {
    return resolveConfiguredBaseDir(envDir);
  }

  if (scope === "test") {
    return path.join(tmpdir(), `openducktor-test-${process.pid}`);
  }

  return path.join(resolveHomeDirectory(), OPENDUCKTOR_CONFIG_DIR_NAMES[scope]);
};
