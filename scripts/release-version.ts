/// <reference types="node" />

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const workspaceRoot = process.cwd();

const desktopPackageJsonPaths = new Set(["apps/electron/package.json"]);

type Mode = "check" | "set";

function usage(): never {
  console.error("Usage: bun run scripts/release-version.ts <check|set> <version>");
  process.exit(1);
}

export function validateVersion(version: string): void {
  const match = version.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) {
    throw new Error(`Invalid version \`${version}\`. Expected semver like 0.1.0 or 0.1.0-rc.1.`);
  }

  const prerelease = match[4];
  if (!prerelease) {
    return;
  }

  const prereleaseIsValid = prerelease.split(".").every((identifier) => {
    if (!/^[0-9A-Za-z-]+$/.test(identifier)) {
      return false;
    }

    if (/^\d+$/.test(identifier)) {
      return identifier === "0" || !identifier.startsWith("0");
    }

    return true;
  });
  if (!prereleaseIsValid) {
    throw new Error(`Invalid version \`${version}\`. Expected semver like 0.1.0 or 0.1.0-rc.1.`);
  }
}

function validateDesktopVersion(version: string): void {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Invalid desktop version \`${version}\`. Expected numeric semver like 0.1.0.`);
  }
}

export function deriveDesktopVersion(releaseVersion: string): string {
  const [desktopVersion] = releaseVersion.split("-");
  validateDesktopVersion(desktopVersion);
  return desktopVersion;
}

export function expectedVersionForEntry(file: string, releaseVersion: string): string {
  if (desktopPackageJsonPaths.has(file)) {
    return deriveDesktopVersion(releaseVersion);
  }

  return releaseVersion;
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

function collectCurrentVersions(): Array<{ file: string; version: string }> {
  return collectWorkspacePackageJsonPaths().map((relativePath) => ({
    file: relativePath,
    version: readJsonVersion(relativePath),
  }));
}

function checkVersions(expectedReleaseVersion: string): void {
  const mismatches = collectCurrentVersions().flatMap((entry) => {
    const expectedVersion = expectedVersionForEntry(entry.file, expectedReleaseVersion);
    return entry.version === expectedVersion ? [] : [{ ...entry, expectedVersion }];
  });

  if (mismatches.length > 0) {
    console.error(`Release version mismatch. Expected release version ${expectedReleaseVersion}.`);
    for (const mismatch of mismatches) {
      console.error(
        `- ${mismatch.file}: ${mismatch.version} (expected ${mismatch.expectedVersion})`,
      );
    }
    process.exit(1);
  }

  const desktopVersion = deriveDesktopVersion(expectedReleaseVersion);
  if (desktopVersion === expectedReleaseVersion) {
    console.log(`All release versions match ${expectedReleaseVersion}.`);
    return;
  }

  console.log(
    `All release versions match ${expectedReleaseVersion}; desktop package version matches ${desktopVersion}.`,
  );
}

function setVersions(version: string): void {
  const desktopVersion = deriveDesktopVersion(version);

  for (const relativePath of collectWorkspacePackageJsonPaths()) {
    writeJsonVersion(relativePath, expectedVersionForEntry(relativePath, version));
  }

  if (desktopVersion === version) {
    console.log(`Updated release version to ${version} in package manifests.`);
    return;
  }

  console.log(
    `Updated release version to ${version}; Electron desktop package version uses ${desktopVersion}.`,
  );
}

function main(): void {
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
}

if (import.meta.main) {
  main();
}
