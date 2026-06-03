import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  ELECTRON_SIDECAR_IDS,
  type ElectronSidecarId,
  electronSidecarDisplayName,
  electronSidecarExecutableName,
} from "./electron-sidecar-manifest";
import type { ElectronReleaseArch, ElectronReleasePlatform } from "./package-build";

type PackagedSidecarPlatform = Exclude<ElectronReleasePlatform, "macos">;

type VerifyPackagedElectronSidecarsInput = {
  arch: ElectronReleaseArch;
  platform: ElectronReleasePlatform;
  releaseDirectory: string;
};

type PackagedSidecarInput = {
  arch: ElectronReleaseArch;
  platform: PackagedSidecarPlatform;
  releaseDirectory: string;
  sidecarId: ElectronSidecarId;
};

const unpackedDirectoryName = ({
  arch,
  platform,
}: Pick<PackagedSidecarInput, "arch" | "platform">): string => {
  const prefix = platform === "windows" ? "win" : "linux";
  return arch === "x64" ? `${prefix}-unpacked` : `${prefix}-${arch}-unpacked`;
};

export const resolvePackagedElectronSidecarPath = ({
  arch,
  platform,
  releaseDirectory,
  sidecarId,
}: PackagedSidecarInput): string => {
  const unpackedDirectory = unpackedDirectoryName({ arch, platform });
  return join(
    releaseDirectory,
    unpackedDirectory,
    "resources",
    "bin",
    electronSidecarExecutableName(sidecarId, platform),
  );
};

const assertPackagedSidecarFile = async ({
  path,
  platform,
  sidecarId,
}: {
  path: string;
  platform: ElectronReleasePlatform;
  sidecarId: ElectronSidecarId;
}): Promise<Stats> => {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile()) {
      throw new Error("expected a file but found a non-file entry");
    }
    if (metadata.size === 0) {
      throw new Error("expected a non-empty file");
    }
    return metadata;
  } catch (cause) {
    if (cause instanceof Error) {
      throw new Error(
        `Invalid packaged Electron ${electronSidecarDisplayName(sidecarId)} sidecar payload for ${platform}: ${
          cause.message
        }. Expected path: ${path}`,
        { cause },
      );
    }
    throw cause;
  }
};

export const verifyPackagedElectronSidecars = async ({
  arch,
  platform,
  releaseDirectory,
}: VerifyPackagedElectronSidecarsInput): Promise<string[]> => {
  if (platform === "macos") {
    return [];
  }

  const sidecarPaths: string[] = [];
  for (const sidecarId of ELECTRON_SIDECAR_IDS) {
    const sidecarPath = resolvePackagedElectronSidecarPath({
      arch,
      platform,
      releaseDirectory,
      sidecarId,
    });
    const metadata = await assertPackagedSidecarFile({ path: sidecarPath, platform, sidecarId });

    if (platform === "linux" && process.platform !== "win32" && (metadata.mode & 0o111) === 0) {
      throw new Error(
        `Invalid packaged Electron ${electronSidecarDisplayName(sidecarId)} sidecar payload for linux: expected an executable file. Expected path: ${sidecarPath}`,
      );
    }

    sidecarPaths.push(sidecarPath);
  }

  return sidecarPaths;
};
