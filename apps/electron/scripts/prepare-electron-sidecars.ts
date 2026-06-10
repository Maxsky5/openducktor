import type { Stats } from "node:fs";
import { chmod, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "bun";
import {
  type ElectronReleaseArch,
  type ElectronReleasePlatform,
  resolveHostReleaseArch,
  resolveHostReleasePlatform,
} from "./electron-release-targets";
import {
  ELECTRON_SIDECAR_IDS,
  type ElectronSidecarId,
  electronSidecarDisplayName,
  electronSidecarExecutableName,
} from "./electron-sidecar-manifest";

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
    if (platform !== "windows" && process.platform !== "win32" && (metadata.mode & 0o111) === 0) {
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
  await assertFileExists(plan.entrypoint, "OpenDucktor MCP entrypoint");
  await rm(plan.outputDirectory, { force: true, recursive: true });
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

export const prepareElectronSidecars = async ({
  arch,
  chmodFile = chmod,
  compileMcp = compileMcpSidecar,
  ...input
}: PrepareElectronSidecarsInput): Promise<{
  plan: ElectronSidecarBuildPlan;
  sidecars: PreparedElectronSidecar[];
}> => {
  void arch;
  const plan = resolveElectronSidecarBuildPlan(input);

  await resetSidecarOutput(plan);
  const mcpSidecar = await compileAndVerifyMcpSidecar({
    chmodFile,
    compile: compileMcp,
    plan,
    platform: input.platform,
  });

  return {
    plan,
    sidecars: [mcpSidecar],
  };
};

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const electronPackageDirectory = dirname(scriptDirectory);
const workspaceRoot = resolve(electronPackageDirectory, "../..");

if (import.meta.main) {
  const prepared = await prepareElectronSidecars({
    arch: resolveHostReleaseArch(process.arch),
    electronPackageDirectory,
    platform: resolveHostReleasePlatform(process.platform),
    workspaceRoot,
  });
  for (const sidecar of prepared.sidecars) {
    console.log(
      `Prepared ${electronSidecarDisplayName(sidecar.id)} sidecar: ${sidecar.outputPath}`,
    );
  }
}
