import { extname } from "node:path";
import type { ElectronReleasePlatform } from "./electron-release-targets";

export const electronBuilderPlatformFlags: Record<
  ElectronReleasePlatform,
  "--linux" | "--mac" | "--win"
> = {
  linux: "--linux",
  macos: "--mac",
  windows: "--win",
};

export const localElectronPackageTargets: Record<ElectronReleasePlatform, readonly string[]> = {
  linux: ["AppImage"],
  macos: ["dmg"],
  windows: ["nsis"],
};

const installableArtifactExtensions: Record<ElectronReleasePlatform, ReadonlySet<string>> = {
  linux: new Set([".AppImage", ".deb"]),
  macos: new Set([".dmg", ".zip"]),
  windows: new Set([".exe", ".zip"]),
};

const companionArtifactExtensions: ReadonlySet<string> = new Set([".blockmap"]);

const releaseArtifactExtensions: Record<ElectronReleasePlatform, ReadonlySet<string>> = {
  linux: new Set([".AppImage", ".deb", ".blockmap"]),
  macos: new Set([".dmg", ".zip", ".blockmap"]),
  windows: new Set([".exe", ".zip", ".blockmap"]),
};

export const macUpdateManifestPattern = /^latest-mac(?:-[a-z0-9]+)?\.yml$/i;
export const canonicalMacUpdateManifestName = "latest-mac.yml";

export const updateMetadataArtifactPatterns: Record<ElectronReleasePlatform, RegExp> = {
  linux: /^latest-linux(?:-[a-z0-9]+)*\.yml$/i,
  macos: macUpdateManifestPattern,
  windows: /^latest(?:-[a-z0-9]+)*\.yml$/i,
};

export const requiredUpdateMetadataLabels: Record<ElectronReleasePlatform, string> = {
  linux: "latest-linux.yml",
  macos: canonicalMacUpdateManifestName,
  windows: "latest.yml",
};

export const isReleaseArtifact = (platform: ElectronReleasePlatform, fileName: string): boolean =>
  releaseArtifactExtensions[platform].has(extname(fileName)) ||
  isUpdateMetadataArtifact(platform, fileName);

export const isInstallableReleaseArtifact = (
  platform: ElectronReleasePlatform,
  fileName: string,
): boolean => installableArtifactExtensions[platform].has(extname(fileName));

export const isUpdateMetadataArtifact = (
  platform: ElectronReleasePlatform,
  fileName: string,
): boolean => updateMetadataArtifactPatterns[platform].test(fileName);

export const isCompanionReleaseArtifact = (fileName: string): boolean =>
  companionArtifactExtensions.has(extname(fileName));

export const detectMacUpdateArtifactArchFromUrl = (url: string): "arm64" | "x64" | null => {
  if (url.includes("arm64")) {
    return "arm64";
  }
  if (url.includes("x64")) {
    return "x64";
  }
  return null;
};
