import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { runCommand } from "@openducktor/build-tools";
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

const hasErrorCode = (cause: unknown, code: string): boolean =>
  cause !== null && typeof cause === "object" && "code" in cause && cause.code === code;

const sha256File = async (path: string): Promise<string> =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

const electronSidecarExtractionCommand = ({
  archivePath,
  asset,
  extractionDirectory,
}: ExtractElectronSidecarArchiveInput): [string, ...string[]] => {
  if (asset.archiveType === "tar.gz") {
    return ["tar", "-xzf", archivePath, "-C", extractionDirectory, asset.executablePath];
  }
  if (process.platform === "win32") {
    return [
      "powershell",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force",
      archivePath,
      extractionDirectory,
    ];
  }
  return ["unzip", "-o", archivePath, asset.executablePath, "-d", extractionDirectory];
};

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
    if (!hasErrorCode(cause, "ENOENT")) {
      await rm(archivePath, { force: true, recursive: true });
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
  await runCommand({
    command: electronSidecarExtractionCommand({ archivePath, asset, extractionDirectory }),
    cwd: extractionDirectory,
    label: `Electron ${electronSidecarDisplayName(asset.id)} sidecar archive extraction`,
  });
};
