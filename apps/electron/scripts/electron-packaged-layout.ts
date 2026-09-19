import { join } from "node:path";
import type { ElectronReleaseArch, ElectronReleasePlatform } from "./electron-release-targets";

type PackagedLayoutInput = {
  arch: ElectronReleaseArch;
  platform: ElectronReleasePlatform;
  releaseDirectory: string;
};

export const resolvePackagedUnpackedDirectory = ({
  arch,
  platform,
  releaseDirectory,
}: PackagedLayoutInput): string =>
  join(releaseDirectory, unpackedDirectoryName({ arch, platform }));

export const resolvePackagedAppResourcesDirectory = ({
  arch,
  platform,
  releaseDirectory,
}: PackagedLayoutInput): string => {
  const unpackedDirectory = resolvePackagedUnpackedDirectory({ arch, platform, releaseDirectory });
  return platform === "macos"
    ? join(unpackedDirectory, "OpenDucktor.app", "Contents", "Resources")
    : join(unpackedDirectory, "resources");
};

const unpackedDirectoryName = ({
  arch,
  platform,
}: Pick<PackagedLayoutInput, "arch" | "platform">): string => {
  if (platform === "macos") {
    return arch === "x64" ? "mac" : `mac-${arch}`;
  }

  const prefix = platform === "windows" ? "win" : "linux";
  return arch === "x64" ? `${prefix}-unpacked` : `${prefix}-${arch}-unpacked`;
};
