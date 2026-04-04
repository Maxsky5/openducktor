import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";

const OPENDUCKTOR_CONFIG_DIR_ENV = "OPENDUCKTOR_CONFIG_DIR";
const OPENDUCKTOR_CARGO_TOOLS_ROOT_ENV = "OPENDUCKTOR_CARGO_TOOLS_ROOT";
const OPENDUCKTOR_CEF_PATH_ENV = "OPENDUCKTOR_CEF_PATH";
const UPSTREAM_CEF_PATH_ENV = "CEF_PATH";

function expandHome(path: string): string {
  if (path === "~") {
    return homedir();
  }

  if (path.startsWith(`~${sep}`)) {
    return resolve(homedir(), path.slice(2));
  }

  return path;
}

function resolveConfiguredPath(envName: string): string | undefined {
  const rawValue = process.env[envName];
  if (rawValue === undefined) {
    return undefined;
  }

  const trimmedValue = rawValue.trim();
  if (trimmedValue.length === 0) {
    throw new Error(`${envName} is set but empty. Provide a valid directory path.`);
  }

  return resolve(expandHome(trimmedValue));
}

function readCargoLock(tauriRoot: string): string {
  return readFileSync(resolve(tauriRoot, "Cargo.lock"), "utf8");
}

function findPackageBlock(lockFile: string, packageName: string): string {
  const packageBlocks = lockFile.split(/\[\[package\]\]\r?\n/);

  for (const packageBlock of packageBlocks) {
    const nameMatch = packageBlock.match(/^name = "([^"]+)"/m);
    if (nameMatch?.[1] === packageName) {
      return packageBlock;
    }
  }

  throw new Error(`Could not resolve the ${packageName} crate from Cargo.lock`);
}

export function readCefVersion(tauriRoot: string): string {
  const lockFilePath = resolve(tauriRoot, "Cargo.lock");
  const packageBlock = findPackageBlock(readCargoLock(tauriRoot), "cef");
  const versionMatch = packageBlock.match(/^version = "([^"]+)"/m);

  if (versionMatch?.[1]) {
    return versionMatch[1];
  }

  throw new Error(`Could not resolve the cef crate version from ${lockFilePath}`);
}

export function readTauriCefRevision(tauriRoot: string): string {
  const lockFilePath = resolve(tauriRoot, "Cargo.lock");
  const packageBlock = findPackageBlock(readCargoLock(tauriRoot), "tauri");
  const sourceMatch = packageBlock.match(
    /^source = "git\+https:\/\/github\.com\/tauri-apps\/tauri\?[^#]+#([0-9a-f]{40})"/m,
  );

  if (sourceMatch?.[1]) {
    return sourceMatch[1];
  }

  throw new Error(`Could not resolve the pinned tauri revision from ${lockFilePath}`);
}

export function resolveOpenducktorDataRoot(): string {
  return resolveConfiguredPath(OPENDUCKTOR_CONFIG_DIR_ENV) ?? resolve(homedir(), ".openducktor");
}

export function resolveCargoToolsRoot(tauriRoot: string): string {
  return (
    resolveConfiguredPath(OPENDUCKTOR_CARGO_TOOLS_ROOT_ENV) ??
    resolve(
      resolveOpenducktorDataRoot(),
      "cache",
      "cargo-tools",
      "tauri-feat-cef",
      readTauriCefRevision(tauriRoot).slice(0, 12),
    )
  );
}

export function resolveCefPath(tauriRoot: string): string {
  return (
    resolveConfiguredPath(OPENDUCKTOR_CEF_PATH_ENV) ??
    resolveConfiguredPath(UPSTREAM_CEF_PATH_ENV) ??
    resolve(resolveOpenducktorDataRoot(), "cache", "cef", readCefVersion(tauriRoot))
  );
}
