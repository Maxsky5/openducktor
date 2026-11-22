import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { OPENDUCKTOR_CONFIG_DIR_NAMES } from "@openducktor/contracts";
import {
  normalizePathSeparators,
  normalizeUserPathInput,
  resolveNormalizedUserPath,
} from "@openducktor/path-support";
import { HostResourceError, HostValidationError } from "../effect/host-errors";
import { resolvePathSymlinks } from "../infrastructure/resolve-path-symlinks";

const OPENDUCKTOR_CONFIG_DIR_ENV = "OPENDUCKTOR_CONFIG_DIR";
export const ALLOW_PRODUCTION_CONFIG_FLAG = "--allow-production-config";

export type OpenDucktorConfigDirScope = "dev" | "production" | "test";
export type OpenDucktorConfigDir = Readonly<{
  root: string;
  scope: OpenDucktorConfigDirScope;
}>;

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

const resolveRequiredUserPath = (
  rawPath: string,
  emptyPath: { field: string; message: string },
): string => {
  const normalized = normalizeUserPathInput(rawPath);
  if (!normalized) {
    throw new HostValidationError(emptyPath);
  }

  return resolveNormalizedUserPath(normalized, {
    resolveHomeDir: resolveHomeDirectory,
    joinHomePath: (homeDir, relativePath) => path.join(homeDir, relativePath),
  });
};

export const resolveUserPath = (rawPath: string): string =>
  resolveRequiredUserPath(rawPath, {
    message: "Path is empty; provide a valid path",
    field: "path",
  });

export const displayUserPath = (absolutePath: string, homeDir: string = homedir()): string => {
  if (homeDir.trim().length === 0) {
    return absolutePath;
  }

  const relative = path.relative(homeDir, absolutePath);
  const isOutsideHome =
    relative.length === 0 ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative);
  if (isOutsideHome) {
    return absolutePath;
  }

  return `~/${normalizePathSeparators(relative)}`;
};

export const resolveOpenDucktorBaseDir = (
  scope: OpenDucktorConfigDirScope,
  env: NodeJS.ProcessEnv = process.env,
): string => {
  const envDir = env[OPENDUCKTOR_CONFIG_DIR_ENV];
  if (envDir !== undefined) {
    return resolveRequiredUserPath(envDir, {
      message: "OPENDUCKTOR_CONFIG_DIR is set but empty; provide a valid directory path",
      field: OPENDUCKTOR_CONFIG_DIR_ENV,
    });
  }

  if (scope === "test") {
    return path.join(tmpdir(), `openducktor-test-${process.pid}`);
  }

  return path.join(resolveHomeDirectory(), OPENDUCKTOR_CONFIG_DIR_NAMES[scope]);
};

export const assertDevelopmentConfigAllowed = (
  scope: OpenDucktorConfigDirScope,
  allowProductionConfig: boolean,
  env: NodeJS.ProcessEnv = process.env,
): void => {
  if (scope !== "dev" || allowProductionConfig) return;
  const configRoot = resolvePathSymlinks(resolveOpenDucktorBaseDir(scope, env));
  const productionRoot = resolvePathSymlinks(resolveOpenDucktorBaseDir("production", {}));
  if (path.relative(productionRoot, configRoot) === "") {
    throw new HostValidationError({
      field: OPENDUCKTOR_CONFIG_DIR_ENV,
      message: `Development startup refused the production config directory ${productionRoot}. Set ${OPENDUCKTOR_CONFIG_DIR_ENV} to a separate directory or stop the production host and rerun with ${ALLOW_PRODUCTION_CONFIG_FLAG}.`,
    });
  }
};
