import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { archiveEntryPathToFilePath } from "./electron-sidecar-archives";
import {
  type ElectronExternalSidecarAsset,
  electronSidecarExecutableName,
} from "./electron-sidecar-manifest";
import {
  prepareElectronSidecars,
  resolveElectronSidecarBuildPlan,
} from "./prepare-electron-sidecars";

type PrepareElectronSidecarsHooks = Pick<
  Parameters<typeof prepareElectronSidecars>[0],
  "chmodFile" | "compileMcp" | "downloadAsset" | "extractArchive" | "verifyArchiveChecksum"
>;

const makeTempWorkspace = async (): Promise<{
  electronPackageDirectory: string;
  workspaceRoot: string;
}> => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "openducktor-electron-sidecars-"));
  const electronPackageDirectory = join(workspaceRoot, "apps", "electron");
  const mcpSourceDirectory = join(workspaceRoot, "packages", "openducktor-mcp", "src");

  await mkdir(electronPackageDirectory, { recursive: true });
  await mkdir(mcpSourceDirectory, { recursive: true });
  await writeFile(join(mcpSourceDirectory, "index.ts"), "console.log('mcp');\n");

  return { electronPackageDirectory, workspaceRoot };
};

const writeExtractedSidecar = async ({
  asset,
  extractionDirectory,
  executable = true,
}: {
  asset: ElectronExternalSidecarAsset;
  executable?: boolean;
  extractionDirectory: string;
}): Promise<string> => {
  const extractedPath = join(
    extractionDirectory,
    ...archiveEntryPathToFilePath(asset.executablePath),
  );
  await mkdir(dirname(extractedPath), { recursive: true });
  await writeFile(extractedPath, "binary");
  if (asset.platform !== "windows") {
    await chmod(extractedPath, executable ? 0o755 : 0o644);
  }
  return extractedPath;
};

const makeSideEffectingHooks = (sideEffects: string[]): PrepareElectronSidecarsHooks => ({
  compileMcp: async ({ outputPaths }) => {
    sideEffects.push("compile");
    await writeFile(outputPaths["openducktor-mcp"], "binary");
  },
  chmodFile: async (path, mode) => {
    sideEffects.push("chmod");
    await chmod(path, mode);
  },
  downloadAsset: async ({ archivePath }) => {
    sideEffects.push("download");
    await mkdir(dirname(archivePath), { recursive: true });
    await writeFile(archivePath, "archive");
  },
  extractArchive: async ({ asset, extractionDirectory }) => {
    sideEffects.push("extract");
    await writeExtractedSidecar({ asset, extractionDirectory });
  },
  verifyArchiveChecksum: async () => {},
});

describe("prepareElectronSidecars", () => {
  test("uses platform-specific executable names", () => {
    expect(electronSidecarExecutableName("openducktor-mcp", "macos")).toBe("openducktor-mcp");
    expect(electronSidecarExecutableName("beads", "linux")).toBe("bd");
    expect(electronSidecarExecutableName("dolt", "windows")).toBe("dolt.exe");
  });

  test("stages sidecars under the Electron package build directory", async () => {
    const { electronPackageDirectory, workspaceRoot } = await makeTempWorkspace();

    expect(
      resolveElectronSidecarBuildPlan({
        electronPackageDirectory,
        platform: "macos",
        workspaceRoot,
      }),
    ).toMatchObject({
      entrypoint: join(workspaceRoot, "packages", "openducktor-mcp", "src", "index.ts"),
      outputDirectory: join(electronPackageDirectory, "build", "sidecars"),
      outputPaths: {
        "openducktor-mcp": join(electronPackageDirectory, "build", "sidecars", "openducktor-mcp"),
        beads: join(electronPackageDirectory, "build", "sidecars", "bd"),
        dolt: join(electronPackageDirectory, "build", "sidecars", "dolt"),
      },
      workspaceRoot,
    });
  });

  test("cleans, compiles, downloads, extracts, and marks Linux sidecars executable", async () => {
    const { electronPackageDirectory, workspaceRoot } = await makeTempWorkspace();
    const staleOutput = join(electronPackageDirectory, "build", "sidecars", "stale");
    const chmodCalls: Array<{ mode: number; path: string }> = [];
    const downloadedAssets: string[] = [];
    const extractedAssets: string[] = [];
    await mkdir(join(electronPackageDirectory, "build", "sidecars"), { recursive: true });
    await writeFile(staleOutput, "stale");

    const prepared = await prepareElectronSidecars({
      arch: "x64",
      electronPackageDirectory,
      platform: "linux",
      workspaceRoot,
      compileMcp: async ({ outputPaths }) => {
        await writeFile(outputPaths["openducktor-mcp"], "#!/bin/sh\nexit 0\n");
      },
      chmodFile: async (path, mode) => {
        chmodCalls.push({ mode, path });
        await chmod(path, mode);
      },
      downloadAsset: async ({ archivePath, asset }) => {
        downloadedAssets.push(asset.id);
        await mkdir(dirname(archivePath), { recursive: true });
        await writeFile(archivePath, "archive");
      },
      extractArchive: async ({ asset, extractionDirectory }) => {
        extractedAssets.push(asset.id);
        await writeExtractedSidecar({ asset, extractionDirectory });
      },
      verifyArchiveChecksum: async () => {},
    });

    await expect(stat(staleOutput)).rejects.toThrow();
    expect(prepared.sidecars.map((sidecar) => sidecar.id)).toEqual([
      "openducktor-mcp",
      "beads",
      "dolt",
    ]);
    expect(downloadedAssets).toEqual(["beads", "dolt"]);
    expect(extractedAssets.sort()).toEqual(["beads", "dolt"]);
    await expect(stat(prepared.plan.outputPaths.beads)).resolves.toMatchObject({ size: 6 });
    await expect(stat(prepared.plan.outputPaths.dolt)).resolves.toMatchObject({ size: 6 });
    expect(chmodCalls.map((call) => call.path).sort()).toEqual(
      [
        prepared.plan.outputPaths["openducktor-mcp"],
        prepared.plan.outputPaths.beads,
        prepared.plan.outputPaths.dolt,
      ].sort(),
    );
  });

  test("rejects unsupported target assets before mutating sidecar output", async () => {
    const { electronPackageDirectory, workspaceRoot } = await makeTempWorkspace();
    const staleOutput = join(electronPackageDirectory, "build", "sidecars", "stale");
    const sideEffects: string[] = [];
    await mkdir(dirname(staleOutput), { recursive: true });
    await writeFile(staleOutput, "stale");

    await expect(
      prepareElectronSidecars({
        arch: "arm64",
        electronPackageDirectory,
        platform: "windows",
        workspaceRoot,
        ...makeSideEffectingHooks(sideEffects),
      }),
    ).rejects.toThrow("No pinned Electron Dolt sidecar asset for windows/arm64");
    expect(sideEffects).toEqual([]);
    await expect(stat(staleOutput)).resolves.toMatchObject({ size: 5 });
  });

  test("rejects a missing MCP entrypoint before mutating sidecar output", async () => {
    const { electronPackageDirectory, workspaceRoot } = await makeTempWorkspace();
    const staleOutput = join(electronPackageDirectory, "build", "sidecars", "stale");
    const mcpEntrypoint = join(workspaceRoot, "packages", "openducktor-mcp", "src", "index.ts");
    const sideEffects: string[] = [];
    await mkdir(dirname(staleOutput), { recursive: true });
    await writeFile(staleOutput, "stale");
    await rm(mcpEntrypoint);

    await expect(
      prepareElectronSidecars({
        arch: "x64",
        electronPackageDirectory,
        platform: "linux",
        workspaceRoot,
        ...makeSideEffectingHooks(sideEffects),
      }),
    ).rejects.toThrow("OpenDucktor MCP entrypoint is missing");
    expect(sideEffects).toEqual([]);
    await expect(stat(staleOutput)).resolves.toMatchObject({ size: 5 });
  });

  test("does not chmod Windows sidecars", async () => {
    const { electronPackageDirectory, workspaceRoot } = await makeTempWorkspace();
    const chmodCalls: Array<{ mode: number; path: string }> = [];

    await prepareElectronSidecars({
      arch: "x64",
      electronPackageDirectory,
      platform: "windows",
      workspaceRoot,
      compileMcp: async ({ outputPaths }) => {
        await writeFile(outputPaths["openducktor-mcp"], "binary");
      },
      chmodFile: async (path, mode) => {
        chmodCalls.push({ mode, path });
      },
      downloadAsset: async ({ archivePath }) => {
        await mkdir(dirname(archivePath), { recursive: true });
        await writeFile(archivePath, "archive");
      },
      extractArchive: async ({ asset, extractionDirectory }) => {
        await writeExtractedSidecar({ asset, extractionDirectory });
      },
      verifyArchiveChecksum: async () => {},
    });

    expect(chmodCalls).toEqual([]);
  });
});
