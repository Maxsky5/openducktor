import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const platform = process.env.TAURI_ENV_PLATFORM ?? process.platform;

if (platform !== "darwin") {
  process.exit(0);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = dirname(scriptDir);
const scriptPath = join(scriptDir, "sign-macos-cef-helper.sh");

const signing = Bun.spawnSync(["bash", scriptPath], {
  cwd: desktopRoot,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

process.exit(signing.exitCode ?? 1);
