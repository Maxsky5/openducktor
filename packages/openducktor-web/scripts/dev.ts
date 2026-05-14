import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "../../../scripts/package-build-helpers";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");

export const runWebDev = async (args: readonly string[] = process.argv.slice(2)): Promise<void> => {
  await runCommand({
    command: ["bun", "src/cli.ts", ...args],
    cwd: packageRoot,
    env: { FORCE_COLOR: "1" },
    label: "Web dev launcher",
  });
};

if (import.meta.main) {
  await runWebDev();
}
