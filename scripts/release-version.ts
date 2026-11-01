/// <reference types="node" />

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

import { workspacePackageJsonPaths } from "./workspace-packages";

const workspaceRoot = process.cwd();

// App stores and desktop installers accept only numeric versions, so these packages use the base
// version of a prerelease.
const numericVersionPackageJsonPaths = new Set([
  "apps/electron/package.json",
  "apps/mobile/package.json",
]);

type Mode = "check" | "set";

const versionedPackageManifestSchema = z
  .object({
    version: z.string().optional(),
  })
  .catchall(z.json());

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
  if (numericVersionPackageJsonPaths.has(file)) {
    return deriveDesktopVersion(releaseVersion);
  }

  return releaseVersion;
}

function collectWorkspacePackageJsonPaths(): string[] {
  return ["package.json", ...workspacePackageJsonPaths()];
}

function readJsonVersion(relativePath: string): string {
  const absolutePath = resolve(workspaceRoot, relativePath);
  const parsed = versionedPackageManifestSchema.parse(
    JSON.parse(readFileSync(absolutePath, "utf8")),
  );
  if (!parsed.version) {
    throw new Error(`Missing version in ${relativePath}`);
  }
  return parsed.version;
}

function writeJsonVersion(relativePath: string, version: string): void {
  const absolutePath = resolve(workspaceRoot, relativePath);
  const manifest = JSON.parse(readFileSync(absolutePath, "utf8"));
  const parsed = versionedPackageManifestSchema.parse(manifest);

  if (parsed.version === version) {
    return;
  }

  manifest.version = version;
  writeFileSync(absolutePath, `${JSON.stringify(manifest, null, 2)}\n`);
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
    `All release versions match ${expectedReleaseVersion}; Electron and mobile package versions match ${desktopVersion}.`,
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
    `Updated release version to ${version}; Electron and mobile package versions use ${desktopVersion}.`,
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
