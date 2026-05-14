import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanDirectory, runCommand } from "../../../scripts/package-build-helpers";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");

export const buildElectronPackage = async (): Promise<void> => {
  await cleanDirectory(join(packageRoot, "dist"));
  await runCommand({
    command: ["bun", "run", "build:main"],
    cwd: packageRoot,
    label: "Electron main build",
  });
  await runCommand({
    command: ["bun", "run", "build:preload"],
    cwd: packageRoot,
    label: "Electron preload build",
  });
  await runCommand({
    command: ["bun", "run", "build:renderer"],
    cwd: packageRoot,
    label: "Electron renderer build",
  });
};

if (import.meta.main) {
  await buildElectronPackage();
}
