import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { ElectronReleaseArch, ElectronReleasePlatform } from "./package-build";

type PackagedMcpSidecarPlatform = Exclude<ElectronReleasePlatform, "macos">;

type VerifyPackagedMcpSidecarInput = {
  arch: ElectronReleaseArch;
  platform: ElectronReleasePlatform;
  releaseDirectory: string;
};

type PackagedMcpSidecarInput = {
  arch: ElectronReleaseArch;
  platform: PackagedMcpSidecarPlatform;
  releaseDirectory: string;
};

const unpackedDirectoryName = ({
  arch,
  platform,
}: Pick<PackagedMcpSidecarInput, "arch" | "platform">): string => {
  const prefix = platform === "windows" ? "win" : "linux";
  return arch === "x64" ? `${prefix}-unpacked` : `${prefix}-${arch}-unpacked`;
};

export const resolvePackagedMcpSidecarPath = ({
  arch,
  platform,
  releaseDirectory,
}: PackagedMcpSidecarInput): string => {
  const unpackedDirectory = unpackedDirectoryName({ arch, platform });

  if (platform === "windows") {
    return join(releaseDirectory, unpackedDirectory, "resources", "bin", "openducktor-mcp.exe");
  }

  return join(releaseDirectory, unpackedDirectory, "resources", "bin", "openducktor-mcp");
};

const assertPackagedSidecarFile = async (
  path: string,
  platform: ElectronReleasePlatform,
): Promise<Stats> => {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile()) {
      throw new Error(`expected a file but found a non-file entry`);
    }
    if (metadata.size === 0) {
      throw new Error(`expected a non-empty file`);
    }
    return metadata;
  } catch (cause) {
    if (cause instanceof Error) {
      throw new Error(
        `Invalid Electron MCP sidecar package payload for ${platform}: ${cause.message}. Expected path: ${path}`,
        { cause },
      );
    }
    throw cause;
  }
};

const canValidateUnixExecutableMode = (): boolean => process.platform !== "win32";

export const verifyPackagedMcpSidecar = async ({
  arch,
  platform,
  releaseDirectory,
}: VerifyPackagedMcpSidecarInput): Promise<string | undefined> => {
  if (platform === "macos") {
    return undefined;
  }

  const sidecarPath = resolvePackagedMcpSidecarPath({ arch, platform, releaseDirectory });
  const metadata = await assertPackagedSidecarFile(sidecarPath, platform);

  if (platform === "linux" && canValidateUnixExecutableMode() && (metadata.mode & 0o111) === 0) {
    throw new Error(
      `Invalid Electron MCP sidecar package payload for linux: expected an executable file. Expected path: ${sidecarPath}`,
    );
  }

  return sidecarPath;
};
