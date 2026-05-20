import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { ElectronReleasePlatform } from "./package-build";

type VerifyPackagedMcpSidecarInput = {
  platform: ElectronReleasePlatform;
  releaseDirectory: string;
};

export const resolvePackagedMcpSidecarPath = ({
  platform,
  releaseDirectory,
}: VerifyPackagedMcpSidecarInput): string => {
  if (platform === "windows") {
    return join(releaseDirectory, "win-unpacked", "resources", "bin", "openducktor-mcp.exe");
  }
  if (platform === "linux") {
    return join(releaseDirectory, "linux-unpacked", "resources", "bin", "openducktor-mcp");
  }

  throw new Error(`Electron MCP sidecar package validation is not defined for ${platform}.`);
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

export const verifyPackagedMcpSidecar = async ({
  platform,
  releaseDirectory,
}: VerifyPackagedMcpSidecarInput): Promise<string | undefined> => {
  if (platform === "macos") {
    return undefined;
  }

  const sidecarPath = resolvePackagedMcpSidecarPath({ platform, releaseDirectory });
  const metadata = await assertPackagedSidecarFile(sidecarPath, platform);

  if (platform === "linux" && (metadata.mode & 0o111) === 0) {
    throw new Error(
      `Invalid Electron MCP sidecar package payload for linux: expected an executable file. Expected path: ${sidecarPath}`,
    );
  }

  return sidecarPath;
};
