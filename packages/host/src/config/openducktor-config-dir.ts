import { homedir } from "node:os";
import path from "node:path";
import { HostResourceError, HostValidationError } from "../effect/host-errors";

export const OPENDUCKTOR_CONFIG_DIR_ENV = "OPENDUCKTOR_CONFIG_DIR";
export const DEFAULT_CONFIG_DIR_NAME = ".openducktor";

export const stripMatchingQuotes = (value: string): string => {
  if (value.length < 2) {
    return value;
  }

  const first = value.at(0);
  const last = value.at(-1);
  if ((first === `"` && last === `"`) || (first === `'` && last === `'`)) {
    return value.slice(1, -1);
  }

  return value;
};

export const resolveHomeDirectory = (): string => {
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
  const trimmed = rawPath.trim();
  if (!trimmed) {
    throw new HostValidationError({
      message: "Path is empty; provide a valid path",
      field: "path",
    });
  }

  const unquoted = stripMatchingQuotes(trimmed).trim();
  if (!unquoted) {
    throw new HostValidationError({
      message: "Path is empty; provide a valid path",
      field: "path",
    });
  }

  if (unquoted === "~") {
    return resolveHomeDirectory();
  }

  const homeRelativePrefix = unquoted.startsWith("~/")
    ? "~/"
    : unquoted.startsWith("~\\")
      ? "~\\"
      : null;

  if (!homeRelativePrefix) {
    return unquoted;
  }

  return path.join(resolveHomeDirectory(), unquoted.slice(homeRelativePrefix.length));
};

export const resolveOpenDucktorBaseDir = (env: NodeJS.ProcessEnv = process.env): string => {
  const envDir = env[OPENDUCKTOR_CONFIG_DIR_ENV];
  if (envDir !== undefined) {
    if (envDir.trim().length === 0) {
      throw new HostValidationError({
        message: "OPENDUCKTOR_CONFIG_DIR is set but empty; provide a valid directory path",
        field: OPENDUCKTOR_CONFIG_DIR_ENV,
      });
    }

    return resolveUserPath(envDir);
  }

  return path.join(resolveHomeDirectory(), DEFAULT_CONFIG_DIR_NAME);
};
