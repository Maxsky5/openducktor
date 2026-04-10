import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync, statSync } from "node:fs";
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
const cefVersion = readCefVersion(tauriRoot);

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

function isRunnableBinary(binaryPath: string, args: string[]): boolean {
  if (!existsSync(binaryPath)) {
    return false;
  }

  try {
    if (!statSync(binaryPath).isFile()) {
      return false;
    }
  } catch {
    return false;
  }

  const result = spawnSync(binaryPath, args, {
    cwd: desktopRoot,
    env: commandEnv(),
    stdio: "ignore",
  });

  return result.status === 0;
}

function hasValidExportedCefBundle(): boolean {
  if (!existsSync(cefPath)) {
    return false;
  }

  const requiredEntries = [
    resolve(cefPath, "archive.json"),
    resolve(cefPath, "include"),
    resolve(cefPath, "libcef_dll"),
  ];

  if (process.platform === "darwin") {
    requiredEntries.push(resolve(cefPath, "Chromium Embedded Framework.framework"));
  }

  return requiredEntries.every((entryPath) => existsSync(entryPath));
}

await (async () => {
  if (process.platform === "darwin") {
    await run("rustup", ["target", "add", "x86_64-apple-darwin"]);
  }

  if (!isRunnableBinary(cargoTauriPath, ["--version"])) {
    rmSync(cargoTauriRoot, { force: true, recursive: true });
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

  if (!isRunnableBinary(exportCefDirPath, ["--help"])) {
    rmSync(exportCefToolRoot, { force: true, recursive: true });
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
      cefVersion,
    ]);
  }

  if (!existsSync(exportCefDirPath)) {
    throw new Error(`Missing export-cef-dir at ${exportCefDirPath}`);
  }

  if (!hasValidExportedCefBundle()) {
    rmSync(cefPath, { force: true, recursive: true });
    await run(exportCefDirPath, [cefPath]);
  }

  if (process.platform === "darwin") {
    await run("xattr", ["-dr", "com.apple.quarantine", cefPath]);
  }
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
