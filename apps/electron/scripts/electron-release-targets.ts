import { ElectronOperationError, ElectronValidationError } from "../src/effect/electron-errors";
import { Effect } from "effect";

export type ElectronReleasePlatform = "linux" | "macos" | "windows";
export type ElectronReleaseArch = "arm64" | "x64";

export const detectHostReleasePlatform = (
  platform: NodeJS.Platform,
): ElectronReleasePlatform | undefined => {
  if (platform === "darwin") return "macos";
  if (platform === "linux") return "linux";
  if (platform === "win32") return "windows";
  return undefined;
};

export const detectHostReleaseArch = (
  arch: NodeJS.Architecture,
): ElectronReleaseArch | undefined => {
  if (arch === "arm64") return "arm64";
  if (arch === "x64") return "x64";
  return undefined;
};

const unsupportedHostPlatformError = (platform: NodeJS.Platform): ElectronValidationError =>
  new ElectronValidationError({
    operation: "electron.release-target.resolve-host-platform",
    message: `Unsupported Electron release host platform: ${platform}`,
    platform,
  });

const unsupportedHostArchError = (arch: NodeJS.Architecture): ElectronValidationError =>
  new ElectronValidationError({
    operation: "electron.release-target.resolve-host-arch",
    message: `Unsupported Electron release host architecture: ${arch}`,
    arch,
  });

export const resolveHostReleasePlatform = (platform: NodeJS.Platform): ElectronReleasePlatform => {
  const target = detectHostReleasePlatform(platform);
  if (target) {
    return target;
  }

  throw unsupportedHostPlatformError(platform);
};

export const resolveHostReleaseArch = (arch: NodeJS.Architecture): ElectronReleaseArch => {
  const target = detectHostReleaseArch(arch);
  if (target) {
    return target;
  }

  throw unsupportedHostArchError(arch);
};

export const assertMatchingElectronReleaseHost = ({
  arch,
  platform,
}: {
  arch: ElectronReleaseArch;
  platform: ElectronReleasePlatform;
}): Effect.Effect<void, ElectronOperationError | ElectronValidationError> =>
  Effect.gen(function* () {
    const hostPlatform = detectHostReleasePlatform(process.platform);
    if (!hostPlatform) {
      return yield* Effect.fail(unsupportedHostPlatformError(process.platform));
    }
    const hostArch = detectHostReleaseArch(process.arch);
    if (!hostArch) {
      return yield* Effect.fail(unsupportedHostArchError(process.arch));
    }
    if (hostPlatform !== platform || hostArch !== arch) {
      return yield* Effect.fail(
        new ElectronOperationError({
          operation: "electron.release-target.assert-matching-host",
          message: `The Electron package for ${platform} ${arch} must be built and verified on a matching host. This host is ${hostPlatform} ${hostArch}. Build the package on a ${platform} ${arch} host.`,
          arch,
          platform,
        }),
      );
    }
  });
