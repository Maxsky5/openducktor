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

export const defaultElectronUpdateChannel = "latest";

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const getCanonicalMacUpdateManifestName = (
  updateChannel = defaultElectronUpdateChannel,
): string => `${updateChannel}-mac.yml`;

export const createMacUpdateManifestPattern = (
  updateChannel = defaultElectronUpdateChannel,
): RegExp => new RegExp(`^${escapeRegExp(updateChannel)}-mac(?:-[a-z0-9]+)?\\.yml$`, "i");

const updateMetadataArtifactPatterns = (
  updateChannel = defaultElectronUpdateChannel,
): Record<ElectronReleasePlatform, RegExp> => ({
  linux: new RegExp(`^${escapeRegExp(updateChannel)}-linux(?:-[a-z0-9]+)*\\.yml$`, "i"),
  macos: createMacUpdateManifestPattern(updateChannel),
  windows: new RegExp(`^${escapeRegExp(updateChannel)}(?:-[a-z0-9]+)*\\.yml$`, "i"),
});

export const getRequiredUpdateMetadataLabel = (
  platform: ElectronReleasePlatform,
  updateChannel = defaultElectronUpdateChannel,
): string => {
  if (platform === "linux") return `${updateChannel}-linux.yml`;
  if (platform === "macos") return getCanonicalMacUpdateManifestName(updateChannel);
  return `${updateChannel}.yml`;
};

export const isReleaseArtifact = (
  platform: ElectronReleasePlatform,
  fileName: string,
  updateChannel = defaultElectronUpdateChannel,
): boolean =>
  releaseArtifactExtensions[platform].has(extname(fileName)) ||
  isUpdateMetadataArtifact(platform, fileName, updateChannel);

export const isInstallableReleaseArtifact = (
  platform: ElectronReleasePlatform,
  fileName: string,
): boolean => installableArtifactExtensions[platform].has(extname(fileName));

export const isUpdateMetadataArtifact = (
  platform: ElectronReleasePlatform,
  fileName: string,
  updateChannel = defaultElectronUpdateChannel,
): boolean => updateMetadataArtifactPatterns(updateChannel)[platform].test(fileName);

export const isCompanionReleaseArtifact = (fileName: string): boolean =>
  companionArtifactExtensions.has(extname(fileName));

const macUpdateArtifactArchPattern = /(?:^|[^a-z0-9])(arm64|x64)(?=$|[^a-z0-9])/i;

export const detectMacUpdateArtifactArchFromUrl = (url: string): "arm64" | "x64" | null => {
  const match = macUpdateArtifactArchPattern.exec(url);
  const arch = match?.[1]?.toLowerCase();
  return arch === "arm64" || arch === "x64" ? arch : null;
};
