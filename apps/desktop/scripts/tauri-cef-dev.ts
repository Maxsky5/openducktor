import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { resolveCargoTauriToolsRoot, resolveCefPath } from "./cef-paths";

const desktopRoot = process.cwd();
const tauriRoot = resolve(desktopRoot, "src-tauri");
const macosCefDevConfigPath = resolve(tauriRoot, "tauri.cef-dev.conf.json");
const cargoTauriPath = resolve(
  resolveCargoTauriToolsRoot(tauriRoot),
  "bin",
  process.platform === "win32" ? "cargo-tauri.exe" : "cargo-tauri",
);
const cefPath = resolveCefPath(tauriRoot);

if (!existsSync(cargoTauriPath)) {
  console.error("Missing cargo-tauri. Run `bun run tauri:setup:cef` first.");
  process.exit(1);
}

const tauriArgs = ["dev"];

if (process.platform === "darwin") {
  tauriArgs.push("--config", macosCefDevConfigPath);
}

tauriArgs.push("--features", "cef", "--", "--no-default-features", ...process.argv.slice(2));

const child = spawn(cargoTauriPath, tauriArgs, {
  cwd: desktopRoot,
  env: {
    ...process.env,
    CEF_PATH: cefPath,
    APPLE_SIGNING_IDENTITY:
      process.platform === "darwin"
        ? (process.env.APPLE_SIGNING_IDENTITY ?? "-")
        : process.env.APPLE_SIGNING_IDENTITY,
  },
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
