import { chmod, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "bun";

export type McpSidecarBuildPlan = {
  entrypoint: string;
  outputDirectory: string;
  outputPath: string;
  workspaceRoot: string;
};

type ResolveMcpSidecarBuildPlanInput = {
  electronPackageDirectory: string;
  platform: NodeJS.Platform;
  workspaceRoot: string;
};

type PrepareMcpSidecarInput = ResolveMcpSidecarBuildPlanInput & {
  chmodFile?: (path: string, mode: number) => Promise<void>;
  compile?: (plan: McpSidecarBuildPlan) => Promise<void>;
};

export const mcpSidecarExecutableName = (platform: NodeJS.Platform): string =>
  platform === "win32" ? "openducktor-mcp.exe" : "openducktor-mcp";

export const resolveMcpSidecarBuildPlan = ({
  electronPackageDirectory,
  platform,
  workspaceRoot,
}: ResolveMcpSidecarBuildPlanInput): McpSidecarBuildPlan => {
  const outputDirectory = join(electronPackageDirectory, "build", "sidecars");

  return {
    entrypoint: join(workspaceRoot, "packages", "openducktor-mcp", "src", "index.ts"),
    outputDirectory,
    outputPath: join(outputDirectory, mcpSidecarExecutableName(platform)),
    workspaceRoot,
  };
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

const compileMcpSidecar = async (plan: McpSidecarBuildPlan): Promise<void> => {
  await $`bun build --compile --outfile ${plan.outputPath} ${plan.entrypoint}`;
};

export const prepareMcpSidecar = async ({
  chmodFile = chmod,
  compile = compileMcpSidecar,
  ...input
}: PrepareMcpSidecarInput): Promise<McpSidecarBuildPlan> => {
  const plan = resolveMcpSidecarBuildPlan(input);

  await assertFileExists(plan.entrypoint, "OpenDucktor MCP entrypoint");
  await rm(plan.outputDirectory, { force: true, recursive: true });
  await mkdir(plan.outputDirectory, { recursive: true });
  await compile(plan);
  await assertFileExists(plan.outputPath, "Compiled OpenDucktor MCP sidecar");

  if (input.platform !== "win32") {
    await chmodFile(plan.outputPath, 0o755);
  }

  return plan;
};

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const electronPackageDirectory = dirname(scriptDirectory);
const workspaceRoot = resolve(electronPackageDirectory, "../..");

if (import.meta.main) {
  const plan = await prepareMcpSidecar({
    electronPackageDirectory,
    platform: process.platform,
    workspaceRoot,
  });
  console.log(`Prepared OpenDucktor MCP sidecar: ${plan.outputPath}`);
}
