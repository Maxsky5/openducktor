import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { markExecutable, runCommand } from "../../../scripts/package-build-helpers";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");
const outputPath = join(packageRoot, "dist", "cli.js");

export const buildWebCli = async (): Promise<void> => {
  await runCommand({
    command: [
      "bun",
      "build",
      "--target=bun",
      "--external",
      "vite",
      "--outfile",
      outputPath,
      "src/cli.ts",
    ],
    cwd: packageRoot,
    label: "Web CLI build",
  });
  await markExecutable(outputPath);
};

if (import.meta.main) {
  await buildWebCli();
}
