/// <reference types="node" />

import TOML from "@iarna/toml";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const workspaceRoot = process.cwd();

const tauriConfigPath = "apps/desktop/src-tauri/tauri.conf.json";
const cargoTomlPath = "apps/desktop/src-tauri/Cargo.toml";

type Mode = "check" | "set";

type CargoManifest = {
  package?: { name?: string; version?: string };
  workspace?: { package?: { version?: string }; members?: string[] };
};

type CargoLock = {
  package?: Array<{ name?: string; version?: string }>;
};

function usage(): never {
  console.error("Usage: bun run scripts/release-version.ts <check|set> <version>");
  process.exit(1);
}

function validateVersion(version: string): void {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid version \`${version}\`. Expected semver like 0.1.0 or 0.1.0-rc.1.`);
  }
}

function readRootWorkspacePatterns(): string[] {
  const rootPackageJsonPath = resolve(workspaceRoot, "package.json");
  const parsed = JSON.parse(readFileSync(rootPackageJsonPath, "utf8")) as { workspaces?: unknown };

  if (!Array.isArray(parsed.workspaces)) {
    throw new Error("Root package.json must define workspaces as an array.");
  }

  return parsed.workspaces.filter((value): value is string => typeof value === "string");
}

function expandWorkspacePattern(pattern: string): string[] {
  if (!pattern.endsWith("/*")) {
    const directWorkspacePath = pattern.endsWith("/package.json")
      ? pattern
      : join(pattern, "package.json");
    const directWorkspaceAbsolutePath = resolve(workspaceRoot, directWorkspacePath);
    return existsSync(directWorkspaceAbsolutePath) ? [directWorkspacePath] : [];
  }

  const parentRelativePath = pattern.slice(0, -2);
  const parentAbsolutePath = resolve(workspaceRoot, parentRelativePath);
  const childNames = readdirSync(parentAbsolutePath).sort((left, right) =>
    left.localeCompare(right),
  );

  return childNames.flatMap((childName) => {
    const childRelativePath = join(parentRelativePath, childName);
    const childAbsolutePath = resolve(workspaceRoot, childRelativePath);

    if (!statSync(childAbsolutePath).isDirectory()) {
      return [];
    }

    const packageJsonPath = resolve(childAbsolutePath, "package.json");
    if (!existsSync(packageJsonPath)) {
      return [];
    }

    return [`${childRelativePath}/package.json`];
  });
}

function collectWorkspacePackageJsonPaths(): string[] {
  return [
    "package.json",
    ...readRootWorkspacePatterns().flatMap((pattern) => expandWorkspacePattern(pattern)),
  ];
}

function readJsonVersion(relativePath: string): string {
  const absolutePath = resolve(workspaceRoot, relativePath);
  const parsed = JSON.parse(readFileSync(absolutePath, "utf8")) as { version?: string };
  if (!parsed.version) {
    throw new Error(`Missing version in ${relativePath}`);
  }
  return parsed.version;
}

function writeJsonVersion(relativePath: string, version: string): void {
  const absolutePath = resolve(workspaceRoot, relativePath);
  const parsed = JSON.parse(readFileSync(absolutePath, "utf8")) as Record<string, unknown>;

  if (parsed.version === version) {
    return;
  }

  parsed.version = version;
  writeFileSync(absolutePath, `${JSON.stringify(parsed, null, 2)}\n`);
}

function readTauriConfigVersion(): string {
  const absolutePath = resolve(workspaceRoot, tauriConfigPath);
  const parsed = JSON.parse(readFileSync(absolutePath, "utf8")) as { version?: string };
  if (!parsed.version) {
    throw new Error(`Missing version in ${tauriConfigPath}`);
  }
  return parsed.version;
}

function writeTauriConfigVersion(version: string): void {
  const absolutePath = resolve(workspaceRoot, tauriConfigPath);
  const parsed = JSON.parse(readFileSync(absolutePath, "utf8")) as Record<string, unknown>;

  if (parsed.version === version) {
    return;
  }

  parsed.version = version;
  writeFileSync(absolutePath, `${JSON.stringify(parsed, null, 2)}\n`);
}

function readCargoManifest(): CargoManifest {
  const absolutePath = resolve(workspaceRoot, cargoTomlPath);
  return TOML.parse(readFileSync(absolutePath, "utf8")) as CargoManifest;
}

function readCargoManifestAtPath(relativePath: string): CargoManifest {
  const absolutePath = resolve(workspaceRoot, relativePath);
  return TOML.parse(readFileSync(absolutePath, "utf8")) as CargoManifest;
}

function readCargoLock(): CargoLock {
  const absolutePath = resolve(workspaceRoot, "apps/desktop/src-tauri/Cargo.lock");
  return TOML.parse(readFileSync(absolutePath, "utf8")) as CargoLock;
}

function resolveCargoWorkspaceMemberManifestPath(memberPath: string): string {
  const tauriWorkspaceRoot = resolve(workspaceRoot, "apps/desktop/src-tauri");

  if (isAbsolute(memberPath)) {
    throw new Error(`Unsupported absolute Cargo workspace member path: ${memberPath}`);
  }

  const resolvedMemberRoot = resolve(tauriWorkspaceRoot, memberPath);
  const relativeMemberRoot = relative(tauriWorkspaceRoot, resolvedMemberRoot);
  if (relativeMemberRoot.startsWith("..") || relativeMemberRoot === "") {
    throw new Error(`Unsupported Cargo workspace member path outside src-tauri: ${memberPath}`);
  }

  const resolvedManifestPath = resolve(resolvedMemberRoot, "Cargo.toml");
  const relativeManifestPath = relative(tauriWorkspaceRoot, resolvedManifestPath);
  if (relativeManifestPath.startsWith("..")) {
    throw new Error(`Unsupported Cargo workspace member manifest path: ${memberPath}`);
  }

  return relative(workspaceRoot, resolvedManifestPath);
}

function collectCargoPackageNames(): string[] {
  const rootManifest = readCargoManifest();
  const rootPackageName = rootManifest.package?.name;
  const workspaceMembers = rootManifest.workspace?.members ?? [];

  if (!rootPackageName) {
    throw new Error(`Missing [package].name in ${cargoTomlPath}`);
  }

  const memberPackageNames = workspaceMembers.map((memberPath) => {
    const memberManifestPath = resolveCargoWorkspaceMemberManifestPath(memberPath);
    const memberManifest = readCargoManifestAtPath(memberManifestPath);
    const memberName = memberManifest.package?.name;

    if (!memberName) {
      throw new Error(`Missing [package].name in ${memberManifestPath}`);
    }

    return memberName;
  });

  return [rootPackageName, ...memberPackageNames];
}

function readCargoVersions(): { packageVersion: string; workspaceVersion: string } {
  const manifest = readCargoManifest();
  const packageVersion = manifest.package?.version;
  const workspaceVersion = manifest.workspace?.package?.version;

  if (!packageVersion || !workspaceVersion) {
    throw new Error(`Could not resolve Cargo versions from ${cargoTomlPath}`);
  }

  return {
    packageVersion,
    workspaceVersion,
  };
}

function writeCargoVersions(version: string): void {
  const absolutePath = resolve(workspaceRoot, cargoTomlPath);
  const manifest = readCargoManifest();

  if (!manifest.package) {
    throw new Error(`Missing [package] in ${cargoTomlPath}`);
  }

  if (!manifest.workspace?.package) {
    throw new Error(`Missing [workspace.package] in ${cargoTomlPath}`);
  }

  if (manifest.package.version === version && manifest.workspace.package.version === version) {
    return;
  }

  manifest.package.version = version;
  manifest.workspace.package.version = version;
  writeFileSync(absolutePath, TOML.stringify(manifest));
}

function readCargoLockVersions(): Array<{ file: string; version: string }> {
  const lockFile = readCargoLock();
  const packages = lockFile.package ?? [];

  return collectCargoPackageNames().map((packageName) => {
    const entry = packages.find((pkg) => pkg.name === packageName);

    if (!entry?.version) {
      throw new Error(`Could not resolve ${packageName} from apps/desktop/src-tauri/Cargo.lock`);
    }

    return {
      file: `apps/desktop/src-tauri/Cargo.lock [${packageName}]`,
      version: entry.version,
    };
  });
}

function syncCargoLock(): void {
  const tauriWorkspaceRoot = resolve(workspaceRoot, "apps/desktop/src-tauri");
  // `cargo metadata` refreshes local workspace package versions in Cargo.lock without the
  // broad dependency churn that `cargo generate-lockfile` caused in this repo.
  const result = spawnSync("cargo", ["metadata", "--format-version", "1"], {
    cwd: tauriWorkspaceRoot,
    env: process.env,
    stdio: ["ignore", "ignore", "inherit"],
  });

  if (result.error) {
    throw new Error(
      `Failed to run cargo metadata in ${tauriWorkspaceRoot}: ${result.error.message}. Ensure Cargo is installed and available on PATH.`,
    );
  }

  if (result.status !== 0) {
    throw new Error(`cargo metadata failed in ${tauriWorkspaceRoot}`);
  }
}

function collectCurrentVersions(): Array<{ file: string; version: string }> {
  const entries: Array<{ file: string; version: string }> = collectWorkspacePackageJsonPaths().map(
    (relativePath) => ({
      file: relativePath,
      version: readJsonVersion(relativePath),
    }),
  );

  entries.push({ file: tauriConfigPath, version: readTauriConfigVersion() });
  const cargoVersions = readCargoVersions();
  entries.push({ file: `${cargoTomlPath} [package]`, version: cargoVersions.packageVersion });
  entries.push({
    file: `${cargoTomlPath} [workspace.package]`,
    version: cargoVersions.workspaceVersion,
  });
  entries.push(...readCargoLockVersions());
  return entries;
}

function checkVersions(expectedVersion: string): void {
  const mismatches = collectCurrentVersions().filter((entry) => entry.version !== expectedVersion);

  if (mismatches.length > 0) {
    console.error(`Release version mismatch. Expected ${expectedVersion}.`);
    for (const mismatch of mismatches) {
      console.error(`- ${mismatch.file}: ${mismatch.version}`);
    }
    process.exit(1);
  }

  console.log(`All release versions match ${expectedVersion}.`);
}

function setVersions(version: string): void {
  for (const relativePath of collectWorkspacePackageJsonPaths()) {
    writeJsonVersion(relativePath, version);
  }

  writeTauriConfigVersion(version);
  writeCargoVersions(version);
  syncCargoLock();

  console.log(
    `Updated release version to ${version} in package manifests, Tauri config, and Cargo.lock.`,
  );
}

const [, , rawMode, rawVersion] = process.argv;

if (!rawMode || !rawVersion) {
  usage();
}

if (rawMode !== "check" && rawMode !== "set") {
  usage();
}

validateVersion(rawVersion);

const mode: Mode = rawMode;

if (mode === "check") {
  checkVersions(rawVersion);
} else {
  setVersions(rawVersion);
}
