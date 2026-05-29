import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { markExecutable, runCommand } from "../../../scripts/package-build-helpers";
import { WEB_PACKAGE_MCP_ENTRYPOINT } from "../src/web-runtime-distribution";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");
const workspaceRoot = resolve(packageRoot, "../..");
const outputPath = join(packageRoot, "dist", WEB_PACKAGE_MCP_ENTRYPOINT);

export const buildWebMcpEntrypoint = async (): Promise<void> => {
  await runCommand({
    command: [
      "bun",
      "build",
      "--target=bun",
      "--outfile",
      outputPath,
      "--banner",
      "#!/usr/bin/env bun",
      join(workspaceRoot, "packages", "openducktor-mcp", "src", "index.ts"),
    ],
    cwd: packageRoot,
    label: "Web MCP entrypoint build",
  });
  await markExecutable(outputPath);
};

if (import.meta.main) {
  await buildWebMcpEntrypoint();
}
