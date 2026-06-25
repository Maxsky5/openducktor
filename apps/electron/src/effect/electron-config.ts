import { readFileSync } from "node:fs";
import { Effect } from "effect";
import { ElectronValidationError, errorMessage } from "./electron-errors";

export const DEFAULT_RENDERER_DEV_PORT = 1430;

export const resolveRendererDevPortEffect = (
  rawPort: string | undefined,
  operation = "electron.config.resolve-renderer-dev-port",
): Effect.Effect<number, ElectronValidationError> =>
  Effect.try({
    try: () => resolveRendererDevPort(rawPort, operation),
    catch: (cause) =>
      cause instanceof ElectronValidationError
        ? cause
        : new ElectronValidationError({
            operation,
            message: errorMessage(cause),
            field: "ELECTRON_RENDERER_DEV_PORT",
            cause,
          }),
  });

export const resolveRendererDevPort = (
  rawPort: string | undefined,
  operation = "electron.config.resolve-renderer-dev-port",
): number => {
  const trimmedPort = rawPort?.trim();
  if (!trimmedPort) {
    return DEFAULT_RENDERER_DEV_PORT;
  }

  if (!/^\d+$/.test(trimmedPort)) {
    throw new ElectronValidationError({
      operation,
      message: `ELECTRON_RENDERER_DEV_PORT must be a TCP port between 1 and 65535: ${rawPort}`,
      field: "ELECTRON_RENDERER_DEV_PORT",
      details: { rawPort },
    });
  }

  const port = Number(trimmedPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new ElectronValidationError({
      operation,
      message: `ELECTRON_RENDERER_DEV_PORT must be a TCP port between 1 and 65535: ${rawPort}`,
      field: "ELECTRON_RENDERER_DEV_PORT",
      details: { rawPort },
    });
  }

  return port;
};

export const readPackageVersionEffect = (
  packageJsonPath: string,
): Effect.Effect<string, ElectronValidationError> =>
  Effect.try({
    try: () => readPackageVersion(packageJsonPath),
    catch: (cause) =>
      cause instanceof ElectronValidationError
        ? cause
        : new ElectronValidationError({
            operation: "electron.config.read-package-version",
            message: errorMessage(cause),
            path: packageJsonPath,
            cause,
          }),
  });

export const readPackageVersion = (packageJsonPath: string): string => {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
    version?: unknown;
  };
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new ElectronValidationError({
      operation: "electron.config.read-package-version",
      message: `Missing package version in ${packageJsonPath}`,
      path: packageJsonPath,
      field: "version",
    });
  }
  return packageJson.version;
};
