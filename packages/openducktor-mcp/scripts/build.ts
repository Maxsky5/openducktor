import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanDirectory, markExecutable, runCommand } from "../../../scripts/package-build-helpers";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");
const outputPath = join(packageRoot, "dist", "index.js");

export const buildMcpPackage = async (): Promise<void> => {
  await cleanDirectory(join(packageRoot, "dist"));
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
};

if (import.meta.main) {
  await buildMcpPackage();
}
