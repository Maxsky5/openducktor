import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanDirectory, runCommand } from "@openducktor/build-tools";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");

export const buildElectronPackage = async (): Promise<void> => {
  await cleanDirectory(join(packageRoot, "dist"));
  await Promise.all([
    runCommand({
      command: ["bun", "run", "build:main"],
      cwd: packageRoot,
      label: "Electron main build",
    }),
    runCommand({
      command: ["bun", "run", "build:preload"],
      cwd: packageRoot,
      label: "Electron preload build",
    }),
    runCommand({
      command: ["bun", "run", "build:renderer"],
      cwd: packageRoot,
      label: "Electron renderer build",
    }),
  ]);
};

if (import.meta.main) {
  await buildElectronPackage();
}
