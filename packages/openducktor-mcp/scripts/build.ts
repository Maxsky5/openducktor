import { copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanDirectory, markExecutable, runCommand } from "@openducktor/build-tools";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");
const outputPath = join(packageRoot, "dist", "index.js");

if (import.meta.main) {
  await cleanDirectory(join(packageRoot, "dist"));
  await runCommand({
    command: [
      "bun",
      "build",
      "--target=bun",
      "--minify",
      "--keep-names",
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
  await copyFile(join(packageRoot, "index.d.ts"), join(packageRoot, "dist", "index.d.ts"));
}
