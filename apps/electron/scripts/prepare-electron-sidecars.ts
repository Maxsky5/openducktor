import type { Stats } from "node:fs";
import { chmod, copyFile, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "bun";
import {
  archiveEntryPathToFilePath,
  type DownloadElectronSidecarAsset,
  downloadElectronSidecarAsset,
  type ExtractElectronSidecarArchive,
  extractElectronSidecarArchive,
  prepareCachedElectronSidecarArchive,
  type VerifyElectronSidecarArchiveChecksum,
  verifyElectronSidecarArchiveChecksum,
} from "./electron-sidecar-archives";
import {
  ELECTRON_SIDECAR_IDS,
  type ElectronSidecarId,
  electronExternalSidecarAssetFileName,
  electronSidecarDisplayName,
  electronSidecarExecutableName,
  resolveElectronExternalSidecarAsset,
} from "./electron-sidecar-manifest";
import type { ElectronReleaseArch, ElectronReleasePlatform } from "./package-build";

export type ElectronSidecarBuildPlan = {
  entrypoint: string;
  outputDirectory: string;
  outputPaths: Record<ElectronSidecarId, string>;
  workspaceRoot: string;
};

export type PreparedElectronSidecar = {
  id: ElectronSidecarId;
  outputPath: string;
};

type ResolveElectronSidecarBuildPlanInput = {
  electronPackageDirectory: string;
  platform: ElectronReleasePlatform;
  workspaceRoot: string;
};

type PrepareElectronSidecarsInput = ResolveElectronSidecarBuildPlanInput & {
  arch: ElectronReleaseArch;
  chmodFile?: (path: string, mode: number) => Promise<void>;
  compileMcp?: (plan: ElectronSidecarBuildPlan) => Promise<void>;
  downloadAsset?: DownloadElectronSidecarAsset;
  extractArchive?: ExtractElectronSidecarArchive;
  verifyArchiveChecksum?: VerifyElectronSidecarArchiveChecksum;
};

const toElectronReleasePlatform = (platform: NodeJS.Platform): ElectronReleasePlatform => {
  if (platform === "darwin") return "macos";
  if (platform === "linux") return "linux";
  if (platform === "win32") return "windows";
  throw new Error(`Unsupported Electron sidecar host platform: ${platform}`);
};

const toElectronReleaseArch = (arch: NodeJS.Architecture): ElectronReleaseArch => {
  if (arch === "arm64" || arch === "x64") return arch;
  throw new Error(`Unsupported Electron sidecar host architecture: ${arch}`);
};

export const resolveElectronSidecarBuildPlan = ({
  electronPackageDirectory,
  platform,
  workspaceRoot,
}: ResolveElectronSidecarBuildPlanInput): ElectronSidecarBuildPlan => {
  const outputDirectory = join(electronPackageDirectory, "build", "sidecars");
  const outputPaths = Object.fromEntries(
    ELECTRON_SIDECAR_IDS.map((sidecarId) => [
      sidecarId,
      join(outputDirectory, electronSidecarExecutableName(sidecarId, platform)),
    ]),
  ) as Record<ElectronSidecarId, string>;

  return {
    entrypoint: join(workspaceRoot, "packages", "openducktor-mcp", "src", "index.ts"),
    outputDirectory,
    outputPaths,
    workspaceRoot,
  };
};

const assertSidecarFile = async ({
  label,
  path,
  platform,
}: {
  label: string;
  path: string;
  platform: ElectronReleasePlatform;
}): Promise<Stats> => {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile()) {
      throw new Error("expected a file but found a non-file entry");
    }
    if (metadata.size === 0) {
      throw new Error("expected a non-empty file");
    }
    if (platform !== "windows" && (metadata.mode & 0o111) === 0) {
      throw new Error("expected an executable file");
    }
    return metadata;
  } catch (cause) {
    if (cause instanceof Error) {
      throw new Error(`${label} is invalid: ${cause.message}. Expected path: ${path}`, { cause });
    }
    throw cause;
  }
};

const assertFileExists = async (path: string, label: string): Promise<void> => {
  try {
    const metadata = await stat(path);
    if (metadata.isFile()) {
      return;
    }
  } catch {
    // Report a single actionable error below.
  }

  throw new Error(`${label} is missing: ${path}`);
};

const compileMcpSidecar = async (plan: ElectronSidecarBuildPlan): Promise<void> => {
  await $`bun build --compile --outfile ${plan.outputPaths["openducktor-mcp"]} ${plan.entrypoint}`;
};

const resetSidecarOutput = async (plan: ElectronSidecarBuildPlan): Promise<void> => {
  await Promise.all([
    assertFileExists(plan.entrypoint, "OpenDucktor MCP entrypoint"),
    rm(plan.outputDirectory, { force: true, recursive: true }),
  ]);
  await mkdir(plan.outputDirectory, { recursive: true });
};

const compileAndVerifyMcpSidecar = async ({
  chmodFile,
  compile,
  plan,
  platform,
}: {
  chmodFile: (path: string, mode: number) => Promise<void>;
  compile: (plan: ElectronSidecarBuildPlan) => Promise<void>;
  plan: ElectronSidecarBuildPlan;
  platform: ElectronReleasePlatform;
}): Promise<PreparedElectronSidecar> => {
  const outputPath = plan.outputPaths["openducktor-mcp"];
  await compile(plan);
  if (platform !== "windows") {
    await chmodFile(outputPath, 0o755);
  }
  await assertSidecarFile({
    label: "Compiled OpenDucktor MCP sidecar",
    path: outputPath,
    platform,
  });

  return { id: "openducktor-mcp", outputPath };
};

const stageExternalSidecar = async ({
  arch,
  chmodFile,
  download,
  electronPackageDirectory,
  extract,
  plan,
  platform,
  sidecarId,
  verifyChecksum,
}: {
  arch: ElectronReleaseArch;
  chmodFile: (path: string, mode: number) => Promise<void>;
  download: DownloadElectronSidecarAsset;
  electronPackageDirectory: string;
  extract: ExtractElectronSidecarArchive;
  plan: ElectronSidecarBuildPlan;
  platform: ElectronReleasePlatform;
  sidecarId: "beads" | "dolt";
  verifyChecksum: VerifyElectronSidecarArchiveChecksum;
}): Promise<PreparedElectronSidecar> => {
  const asset = resolveElectronExternalSidecarAsset({ arch, id: sidecarId, platform });
  const archivePath = join(
    electronPackageDirectory,
    "build",
    "sidecar-cache",
    sidecarId,
    asset.version,
    electronExternalSidecarAssetFileName(asset),
  );
  const extractionDirectory = join(
    electronPackageDirectory,
    "build",
    "sidecar-extract",
    `${sidecarId}-${platform}-${arch}`,
  );

  await prepareCachedElectronSidecarArchive({ archivePath, asset, download, verifyChecksum });
  await rm(extractionDirectory, { force: true, recursive: true });
  await mkdir(extractionDirectory, { recursive: true });
  await extract({ archivePath, asset, extractionDirectory });

  const sourcePath = join(extractionDirectory, ...archiveEntryPathToFilePath(asset.executablePath));
  await assertSidecarFile({
    label: `Extracted ${electronSidecarDisplayName(sidecarId)} sidecar`,
    path: sourcePath,
    platform,
  });

  const outputPath = plan.outputPaths[sidecarId];
  await copyFile(sourcePath, outputPath);
  if (platform !== "windows") {
    await chmodFile(outputPath, 0o755);
  }
  await assertSidecarFile({
    label: `Staged ${electronSidecarDisplayName(sidecarId)} sidecar`,
    path: outputPath,
    platform,
  });

  return { id: sidecarId, outputPath };
};

export const prepareElectronSidecars = async ({
  arch,
  chmodFile = chmod,
  compileMcp = compileMcpSidecar,
  downloadAsset: download = downloadElectronSidecarAsset,
  extractArchive: extract = extractElectronSidecarArchive,
  verifyArchiveChecksum: verifyChecksum = verifyElectronSidecarArchiveChecksum,
  ...input
}: PrepareElectronSidecarsInput): Promise<{
  plan: ElectronSidecarBuildPlan;
  sidecars: PreparedElectronSidecar[];
}> => {
  const plan = resolveElectronSidecarBuildPlan(input);

  await resetSidecarOutput(plan);
  const mcpSidecar = await compileAndVerifyMcpSidecar({
    chmodFile,
    compile: compileMcp,
    plan,
    platform: input.platform,
  });
  const externalSidecars = await Promise.all(
    (["beads", "dolt"] as const).map((sidecarId) =>
      stageExternalSidecar({
        arch,
        chmodFile,
        download,
        electronPackageDirectory: input.electronPackageDirectory,
        extract,
        plan,
        platform: input.platform,
        sidecarId,
        verifyChecksum,
      }),
    ),
  );

  return {
    plan,
    sidecars: [mcpSidecar, ...externalSidecars],
  };
};

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const electronPackageDirectory = dirname(scriptDirectory);
const workspaceRoot = resolve(electronPackageDirectory, "../..");

if (import.meta.main) {
  const prepared = await prepareElectronSidecars({
    arch: toElectronReleaseArch(process.arch),
    electronPackageDirectory,
    platform: toElectronReleasePlatform(process.platform),
    workspaceRoot,
  });
  for (const sidecar of prepared.sidecars) {
    console.log(
      `Prepared ${electronSidecarDisplayName(sidecar.id)} sidecar: ${sidecar.outputPath}`,
    );
  }
}
