import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

import {
  CARGO_TAURI_CEF_TOOLCHAIN_PATCH,
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
const cargoTauriPatchMarkerPath = resolve(cargoTauriRoot, ".openducktor-toolchain-patch");

function expectedCargoTauriPatchMarker(): string {
  return `${CARGO_TAURI_CEF_TOOLCHAIN_PATCH}\n${tauriRevision}`;
}

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

function run(
  command: string,
  args: string[],
  env = commandEnv(),
  cwd = desktopRoot,
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
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

function hasExpectedCargoTauriToolchain(): boolean {
  if (!isRunnableBinary(cargoTauriPath, ["--version"])) {
    return false;
  }

  try {
    return (
      readFileSync(cargoTauriPatchMarkerPath, "utf8").trim() === expectedCargoTauriPatchMarker()
    );
  } catch {
    return false;
  }
}

function patchTauriBundlerSignOrder(sourceRoot: string): void {
  const bundlerAppPath = resolve(sourceRoot, "crates/tauri-bundler/src/bundle/macos/app.rs");
  const source = readFileSync(bundlerAppPath, "utf8");
  const mainBinarySignBlock = `  let bin_paths = copy_binaries_to_bundle(&bundle_directory, settings)?;\n  sign_paths.extend(bin_paths.into_iter().map(|path| SignTarget {\n    path,\n    is_an_executable: true,\n  }));\n\n  copy_custom_files_to_bundle(&bundle_directory, settings)?;`;
  const deferredMainBinarySignBlock = `  let app_binary_paths = copy_binaries_to_bundle(&bundle_directory, settings)?;\n\n  copy_custom_files_to_bundle(&bundle_directory, settings)?;`;
  const cefHelperSignBlock = `  // Handle CEF support if cef_path is set\n  if let Some(cef_path) = settings.bundle_settings().cef_path.as_ref() {\n    let helper_paths = create_cef_helpers(&bundle_directory, settings, cef_path)?;\n    // Add helper apps to sign paths\n    sign_paths.extend(helper_paths.into_iter().map(|path| SignTarget {\n      path,\n      is_an_executable: true,\n    }));`;
  const beforeSigningBlock = `  }\n\n  if settings.no_sign() {`;
  const signMainAfterCefBlock = `  }\n\n  // The CEF helper .app bundles must be signed before the containing app's\n  // main executable. On macOS Intel, codesign rejects the main executable when\n  // unsigned CEF helper apps are already present under Contents/Frameworks.\n  sign_paths.extend(app_binary_paths.into_iter().map(|path| SignTarget {\n    path,\n    is_an_executable: true,\n  }));\n\n  if settings.no_sign() {`;
  const cefHelperSignBoundaryBlock = `${cefHelperSignBlock}${beforeSigningBlock}`;
  const cefHelperThenMainSignBlock = `${cefHelperSignBlock}${signMainAfterCefBlock}`;

  if (!source.includes(mainBinarySignBlock)) {
    throw new Error("Unable to patch Tauri bundler: main binary signing block was not found.");
  }
  if (!source.includes(cefHelperSignBoundaryBlock)) {
    throw new Error("Unable to patch Tauri bundler: CEF helper signing boundary was not found.");
  }

  writeFileSync(
    bundlerAppPath,
    source
      .replace(mainBinarySignBlock, deferredMainBinarySignBlock)
      .replace(cefHelperSignBoundaryBlock, cefHelperThenMainSignBlock),
  );
}

async function installPatchedCargoTauri(): Promise<void> {
  const sourceRoot = mkdtempSync(join(tmpdir(), "openducktor-tauri-cli-"));

  try {
    await run("git", ["init"], commandEnv(), sourceRoot);
    await run(
      "git",
      ["remote", "add", "origin", "https://github.com/tauri-apps/tauri"],
      commandEnv(),
      sourceRoot,
    );
    await run("git", ["fetch", "--depth", "1", "origin", tauriRevision], commandEnv(), sourceRoot);
    await run("git", ["checkout", "--detach", "FETCH_HEAD"], commandEnv(), sourceRoot);
    patchTauriBundlerSignOrder(sourceRoot);
    await run("rustup", [
      "run",
      "stable",
      "cargo",
      "install",
      "--locked",
      "--root",
      cargoTauriRoot,
      "--path",
      resolve(sourceRoot, "crates/tauri-cli"),
    ]);
    writeFileSync(cargoTauriPatchMarkerPath, `${expectedCargoTauriPatchMarker()}\n`);
  } finally {
    rmSync(sourceRoot, { force: true, recursive: true });
  }
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
    await run("rustup", ["target", "add", "x86_64-apple-darwin", "aarch64-apple-darwin"]);
  }

  if (!hasExpectedCargoTauriToolchain()) {
    rmSync(cargoTauriRoot, { force: true, recursive: true });
    await installPatchedCargoTauri();
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
