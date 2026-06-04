import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  type ElectronExternalSidecarAsset,
  electronExternalSidecarAssetFileName,
  electronSidecarDisplayName,
} from "./electron-sidecar-manifest";

export type DownloadElectronSidecarAssetInput = {
  asset: ElectronExternalSidecarAsset;
  archivePath: string;
};

export type ExtractElectronSidecarArchiveInput = {
  archivePath: string;
  asset: ElectronExternalSidecarAsset;
  extractionDirectory: string;
};

export type DownloadElectronSidecarAsset = (
  input: DownloadElectronSidecarAssetInput,
) => Promise<void>;

export type ExtractElectronSidecarArchive = (
  input: ExtractElectronSidecarArchiveInput,
) => Promise<void>;

export type VerifyElectronSidecarArchiveChecksum = (
  asset: ElectronExternalSidecarAsset,
  archivePath: string,
) => Promise<void>;

export const archiveEntryPathToFilePath = (entryPath: string): string[] =>
  entryPath.replace(/\\/g, "/").replace(/^\.\//, "").split("/").filter(Boolean);

const runCommand = (command: string, args: string[], cwd: string): Promise<void> =>
  new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === "win32",
      stdio: "inherit",
    });

    child.on("error", rejectCommand);
    child.on("exit", (exitCode) => {
      if (exitCode === 0) {
        resolveCommand();
        return;
      }

      rejectCommand(
        new Error(`${command} ${args.join(" ")} exited with code ${exitCode ?? "unknown"}`),
      );
    });
  });

const sha256File = async (path: string): Promise<string> =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

export const verifyElectronSidecarArchiveChecksum = async (
  asset: ElectronExternalSidecarAsset,
  archivePath: string,
): Promise<void> => {
  const actualSha256 = await sha256File(archivePath);
  if (actualSha256 !== asset.sha256) {
    throw new Error(
      `Checksum mismatch for Electron ${electronSidecarDisplayName(asset.id)} sidecar asset ${electronExternalSidecarAssetFileName(
        asset,
      )}: expected ${asset.sha256}, got ${actualSha256}.`,
    );
  }
};

export const downloadElectronSidecarAsset = async ({
  archivePath,
  asset,
}: DownloadElectronSidecarAssetInput): Promise<void> => {
  const response = await fetch(asset.url, {
    headers: { "User-Agent": "openducktor-electron-sidecar-builder" },
  });
  if (!response.ok) {
    throw new Error(
      `Failed downloading Electron ${electronSidecarDisplayName(asset.id)} sidecar asset from ${
        asset.url
      }: HTTP ${response.status}.`,
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error(
      `Downloaded Electron ${electronSidecarDisplayName(asset.id)} sidecar asset is empty: ${
        asset.url
      }`,
    );
  }

  await mkdir(dirname(archivePath), { recursive: true });
  await writeFile(archivePath, bytes);
};

export const prepareCachedElectronSidecarArchive = async ({
  archivePath,
  asset,
  download,
  verifyChecksum,
}: DownloadElectronSidecarAssetInput & {
  download: DownloadElectronSidecarAsset;
  verifyChecksum: VerifyElectronSidecarArchiveChecksum;
}): Promise<void> => {
  try {
    const metadata = await stat(archivePath);
    if (!metadata.isFile()) {
      throw new Error("expected a file but found a non-file entry");
    }
    if (metadata.size === 0) {
      throw new Error("expected a non-empty file");
    }
    await verifyChecksum(asset, archivePath);
    return;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
      throw cause;
    }
  }

  await download({ archivePath, asset });
  await verifyChecksum(asset, archivePath);
};

export const extractElectronSidecarArchive = async ({
  archivePath,
  asset,
  extractionDirectory,
}: ExtractElectronSidecarArchiveInput): Promise<void> => {
  const extractArgs =
    asset.archiveType === "tar.gz"
      ? ["-xzf", archivePath, "-C", extractionDirectory, asset.executablePath]
      : ["-xf", archivePath, "-C", extractionDirectory, asset.executablePath];
  await runCommand("tar", extractArgs, extractionDirectory);
};
