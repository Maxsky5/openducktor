import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";

import {
  readCefVersion,
  readTauriCefRevision,
  resolveCargoTauriToolsRoot,
  resolveCefPath,
  resolveExportCefToolsRoot,
} from "./cef-paths";

const desktopRoot = process.cwd();
const tauriRoot = resolve(desktopRoot, "src-tauri");
const cargoTauriRoot = resolveCargoTauriToolsRoot(tauriRoot);
const cargoTauriBinRoot = resolve(cargoTauriRoot, "bin");
const exportCefToolRoot = resolveExportCefToolsRoot(tauriRoot);
const exportCefToolBinRoot = resolve(exportCefToolRoot, "bin");
const cefPath = resolveCefPath(tauriRoot);
const tauriRevision = readTauriCefRevision(tauriRoot);
const binaryExtension = process.platform === "win32" ? ".exe" : "";
const cargoTauriPath = resolve(cargoTauriBinRoot, `cargo-tauri${binaryExtension}`);
const exportCefDirPath = resolve(exportCefToolBinRoot, `export-cef-dir${binaryExtension}`);

function cargoHomeBinPath(): string {
  return resolve(process.env.CARGO_HOME ?? join(homedir(), ".cargo"), "bin");
}

function commandEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...extra,
    PATH: [cargoTauriBinRoot, exportCefToolBinRoot, cargoHomeBinPath(), process.env.PATH]
      .filter(Boolean)
      .join(delimiter),
  };
}

function run(command: string, args: string[], env = commandEnv()): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: desktopRoot,
      env,
      stdio: "inherit",
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        rejectPromise(
          new Error(
            `Missing required command \`${command}\`. Install rustup and ensure it is available on PATH before running \`bun run tauri:setup:cef\`.`,
          ),
        );
        return;
      }

      rejectPromise(error);
    });
    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`${command} ${args.join(" ")} exited with code ${code ?? 1}`));
    });
  });
}

await (async () => {
  if (process.platform === "darwin") {
    await run("rustup", ["target", "add", "x86_64-apple-darwin"]);
  }

  if (!existsSync(cargoTauriPath)) {
    await run("rustup", [
      "run",
      "stable",
      "cargo",
      "install",
      "--locked",
      "--root",
      cargoTauriRoot,
      "tauri-cli",
      "--git",
      "https://github.com/tauri-apps/tauri",
      "--rev",
      tauriRevision,
    ]);
  }

  if (!existsSync(exportCefDirPath)) {
    await run("rustup", [
      "run",
      "stable",
      "cargo",
      "install",
      "--locked",
      "--root",
      exportCefToolRoot,
      "export-cef-dir",
      "--version",
      readCefVersion(tauriRoot),
    ]);
  }

  if (!existsSync(exportCefDirPath)) {
    throw new Error(`Missing export-cef-dir at ${exportCefDirPath}`);
  }

  if (!existsSync(cefPath)) {
    await run(exportCefDirPath, [cefPath]);
  }

  if (process.platform === "darwin") {
    await run("xattr", ["-dr", "com.apple.quarantine", cefPath]);
  }
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
