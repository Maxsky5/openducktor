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

export const resolveHostReleasePlatform = (platform: NodeJS.Platform): ElectronReleasePlatform => {
  const target = detectHostReleasePlatform(platform);
  if (target) {
    return target;
  }

  throw new Error(`Unsupported Electron release host platform: ${platform}`);
};

export const resolveHostReleaseArch = (arch: NodeJS.Architecture): ElectronReleaseArch => {
  const target = detectHostReleaseArch(arch);
  if (target) {
    return target;
  }

  throw new Error(`Unsupported Electron release host architecture: ${arch}`);
};
