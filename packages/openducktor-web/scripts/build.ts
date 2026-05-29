import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanDirectory, runCommand } from "../../../scripts/package-build-helpers";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");

export const buildWebPackage = async (): Promise<void> => {
  await cleanDirectory(join(packageRoot, "dist"));
  await runCommand({
    command: ["bun", "run", "build:web-shell"],
    cwd: packageRoot,
    label: "Web shell build",
  });
  await runCommand({
    command: ["bun", "run", "build:cli"],
    cwd: packageRoot,
    label: "Web CLI build",
  });
  await runCommand({
    command: ["bun", "run", "build:mcp"],
    cwd: packageRoot,
    label: "Web MCP entrypoint build",
  });
};

if (import.meta.main) {
  await buildWebPackage();
}
