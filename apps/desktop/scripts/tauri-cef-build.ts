import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { resolveCargoToolsRoot, resolveCefPath } from "./cef-paths";

const desktopRoot = process.cwd();
const tauriRoot = resolve(desktopRoot, "src-tauri");
const cargoTauriPath = resolve(
  resolveCargoToolsRoot(tauriRoot),
  "bin",
  process.platform === "win32" ? "cargo-tauri.exe" : "cargo-tauri",
);
const cefPath = resolveCefPath(tauriRoot);

if (!existsSync(cargoTauriPath)) {
  console.error("Missing cargo-tauri. Run `bun run tauri:setup:cef` first.");
  process.exit(1);
}

const child = spawn(
  cargoTauriPath,
  [
    "build",
    "--config",
    "src-tauri/bundle.sidecars.json",
    "--features",
    "cef",
    "--",
    "--no-default-features",
    ...process.argv.slice(2),
  ],
  {
    cwd: desktopRoot,
    env: {
      ...process.env,
      CEF_PATH: cefPath,
      OPENDUCKTOR_PREPARE_SIDECARS: "1",
    },
    stdio: "inherit",
  },
);

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
