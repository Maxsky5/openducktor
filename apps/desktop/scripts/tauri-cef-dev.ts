import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const desktopRoot = process.cwd();
const repoRoot = resolve(desktopRoot, "../..");
const cargoTauriPath = resolve(
  repoRoot,
  ".cargo-tools",
  "bin",
  process.platform === "win32" ? "cargo-tauri.exe" : "cargo-tauri",
);

if (!existsSync(cargoTauriPath)) {
  console.error("Missing cargo-tauri. Run `bun run tauri:setup:cef` first.");
  process.exit(1);
}

const child = spawn(
  cargoTauriPath,
  ["dev", "--no-default-features", "--features", "cef", "--", ...process.argv.slice(2)],
  {
    cwd: desktopRoot,
    env: {
      ...process.env,
      CEF_PATH: process.env.CEF_PATH ?? resolve(repoRoot, ".cache", "cef"),
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
