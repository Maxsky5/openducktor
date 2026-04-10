/// <reference types="node" />

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const workspaceRoot = process.cwd();

const tauriConfigPath = "apps/desktop/src-tauri/tauri.conf.json";
const cargoTomlPath = "apps/desktop/src-tauri/Cargo.toml";

type Mode = "check" | "set";

function usage(): never {
  console.error("Usage: bun run scripts/release-version.ts <check|set> <version>");
  process.exit(1);
  throw new Error("unreachable");
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
    throw new Error(
      `Unsupported workspace pattern \`${pattern}\`. Expected a trailing /* pattern.`,
    );
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
  parsed.version = version;
  writeFileSync(absolutePath, `${JSON.stringify(parsed, null, 2)}\n`);
}

function replaceCargoVersion(source: string, sectionName: string, version: string): string {
  const sectionHeader = `[${sectionName}]`;
  const sectionIndex = source.indexOf(sectionHeader);
  if (sectionIndex === -1) {
    throw new Error(`Missing ${sectionHeader} in ${cargoTomlPath}`);
  }

  const nextSectionIndex = source.indexOf("\n[", sectionIndex + sectionHeader.length);
  const sectionEnd = nextSectionIndex === -1 ? source.length : nextSectionIndex + 1;
  const section = source.slice(sectionIndex, sectionEnd);
  const updatedSection = section.replace(/^version\s*=\s*"[^"]+"$/m, `version = "${version}"`);

  if (updatedSection === section) {
    throw new Error(`Missing version entry in [${sectionName}] inside ${cargoTomlPath}`);
  }

  return `${source.slice(0, sectionIndex)}${updatedSection}${source.slice(sectionEnd)}`;
}

function readCargoVersions(): { packageVersion: string; workspaceVersion: string } {
  const absolutePath = resolve(workspaceRoot, cargoTomlPath);
  const source = readFileSync(absolutePath, "utf8");
  const packageMatch = source.match(/\[package\][\s\S]*?^version\s*=\s*"([^"]+)"$/m);
  const workspaceMatch = source.match(/\[workspace\.package\][\s\S]*?^version\s*=\s*"([^"]+)"$/m);

  if (!packageMatch?.[1] || !workspaceMatch?.[1]) {
    throw new Error(`Could not resolve Cargo versions from ${cargoTomlPath}`);
  }

  return {
    packageVersion: packageMatch[1],
    workspaceVersion: workspaceMatch[1],
  };
}

function writeCargoVersions(version: string): void {
  const absolutePath = resolve(workspaceRoot, cargoTomlPath);
  const source = readFileSync(absolutePath, "utf8");
  const updatedPackage = replaceCargoVersion(source, "package", version);
  const updatedWorkspace = replaceCargoVersion(updatedPackage, "workspace.package", version);
  writeFileSync(absolutePath, updatedWorkspace);
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

  console.log(`Updated release version to ${version} in package manifests and Tauri config.`);
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
