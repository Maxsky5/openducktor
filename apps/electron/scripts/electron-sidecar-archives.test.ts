import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { prepareCachedElectronSidecarArchive } from "./electron-sidecar-archives";
import type { ElectronExternalSidecarAsset } from "./electron-sidecar-manifest";

const tempDirectories = new Set<string>();

const asset = {
  id: "beads",
  version: "1.0.4",
  url: "https://example.test/beads.tar.gz",
  sha256: "checksum",
  archiveType: "tar.gz",
  executablePath: "bd",
} as const satisfies ElectronExternalSidecarAsset;

const makeArchivePath = async (): Promise<string> => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "openducktor-electron-sidecar-archive-"));
  tempDirectories.add(tempDirectory);
  return join(tempDirectory, "cache", "beads.tar.gz");
};

const fileIsMissing = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return false;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return true;
    }
    throw error;
  }
};

afterEach(async () => {
  await Promise.all(
    Array.from(tempDirectories, (tempDirectory) =>
      rm(tempDirectory, { force: true, recursive: true }),
    ),
  );
  tempDirectories.clear();
});

describe("prepareCachedElectronSidecarArchive", () => {
  test("redownloads when a cached archive fails checksum verification", async () => {
    const archivePath = await makeArchivePath();
    let downloadSawMissingArchive = false;
    let verifyCalls = 0;
    await mkdir(dirname(archivePath), { recursive: true });
    await writeFile(archivePath, "stale");

    await prepareCachedElectronSidecarArchive({
      archivePath,
      asset,
      download: async ({ archivePath }) => {
        downloadSawMissingArchive = await fileIsMissing(archivePath);
        await mkdir(dirname(archivePath), { recursive: true });
        await writeFile(archivePath, "fresh");
      },
      verifyChecksum: async () => {
        verifyCalls += 1;
        if (verifyCalls === 1) {
          throw new Error("checksum mismatch");
        }
      },
    });

    expect(downloadSawMissingArchive).toBe(true);
    expect(verifyCalls).toBe(2);
    await expect(Bun.file(archivePath).text()).resolves.toBe("fresh");
  });
});
