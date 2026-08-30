import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanDirectory, markExecutable, runCommand } from "@openducktor/build-tools";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");
const distDirectory = join(packageRoot, "dist");
const outputPath = join(distDirectory, "index.js");
const buildInfoPath = join(distDirectory, "tsconfig.tsbuildinfo");

export const MCP_PACKAGE_BUILD_ARTIFACTS = [
  "host-bridge-client.d.ts",
  "index.d.ts",
  "index.js",
  "lib.d.ts",
  "listed-tool-schema.d.ts",
  "mcp-server.d.ts",
  "odt-task-store.d.ts",
  "path-utils.d.ts",
  "store-context.d.ts",
  "tool-results.d.ts",
] as const;

const assertBuildArtifacts = async (): Promise<void> => {
  await Promise.all(
    MCP_PACKAGE_BUILD_ARTIFACTS.map(async (artifact) => {
      const artifactPath = join(distDirectory, artifact);
      const metadata = await stat(artifactPath).catch((cause: unknown) => {
        throw new Error(`MCP package build artifact is missing: ${artifactPath}`, { cause });
      });
      if (!metadata.isFile()) {
        throw new Error(`MCP package build artifact is not a file: ${artifactPath}`);
      }
    }),
  );
};

export const buildMcpPackage = async (): Promise<void> => {
  await cleanDirectory(distDirectory);
  await runCommand({
    command: [
      "bun",
      "build",
      "--target=bun",
      "--outfile",
      outputPath,
      "--banner",
      "#!/usr/bin/env bun",
      "src/index.ts",
    ],
    cwd: packageRoot,
    label: "MCP package JavaScript build",
  });
  await markExecutable(outputPath);
  await runCommand({
    command: ["bunx", "tsc", "-p", "tsconfig.json", "--emitDeclarationOnly"],
    cwd: packageRoot,
    label: "MCP package declaration build",
  });
  await assertBuildArtifacts();
  await cleanDirectory(buildInfoPath);
};

if (import.meta.main) {
  await buildMcpPackage();
}
