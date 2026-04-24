import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

type PackageManifest = {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

const releasePackages = [
  "packages/contracts",
  "packages/core",
  "packages/adapters-tauri-host",
  "packages/adapters-opencode-sdk",
  "packages/frontend",
  "packages/openducktor-web",
] as const;

const webHostArtifacts = [
  "openducktor-web-host-darwin-arm64",
  "openducktor-web-host-darwin-x64",
] as const;

const dependencySections = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

const version = process.argv[2]?.trim();

if (!version || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error("Usage: bun run scripts/prepare-web-publish-packages.ts <semver-version>");
}

const repoRoot = path.resolve(import.meta.dir, "..");
const manifestPaths = releasePackages.map((packageDir) =>
  path.join(repoRoot, packageDir, "package.json"),
);
const manifests = manifestPaths.map((manifestPath) => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
  if (manifest.version !== version) {
    throw new Error(
      `${manifest.name} version ${manifest.version} does not match release version ${version}.`,
    );
  }
  return { manifestPath, manifest };
});

const releasePackageNames = new Set(manifests.map(({ manifest }) => manifest.name));

const rewriteWorkspaceDependencies = (manifest: PackageManifest): boolean => {
  let changed = false;
  for (const sectionName of dependencySections) {
    const dependencies = manifest[sectionName];
    if (!dependencies) {
      continue;
    }

    for (const [dependencyName, dependencyVersion] of Object.entries(dependencies)) {
      if (!dependencyVersion.startsWith("workspace:")) {
        continue;
      }
      if (!releasePackageNames.has(dependencyName)) {
        throw new Error(
          `${manifest.name} depends on unsupported workspace package ${dependencyName}. Add it to the web publish package set or remove the runtime dependency.`,
        );
      }
      dependencies[dependencyName] = `^${version}`;
      changed = true;
    }
  }
  return changed;
};

const verifyChecksum = (binaryPath: string): void => {
  if (!existsSync(binaryPath) || !statSync(binaryPath).isFile()) {
    throw new Error(`Missing OpenDucktor web host artifact: ${binaryPath}`);
  }
  const checksumPath = `${binaryPath}.sha256`;
  if (!existsSync(checksumPath) || !statSync(checksumPath).isFile()) {
    throw new Error(`Missing OpenDucktor web host checksum: ${checksumPath}`);
  }

  const expected = readFileSync(checksumPath, "utf8").trim().split(/\s+/)[0];
  const actual = createHash("sha256").update(readFileSync(binaryPath)).digest("hex");
  if (actual !== expected) {
    throw new Error(
      `OpenDucktor web host checksum mismatch for ${binaryPath}. Expected ${expected}, received ${actual}.`,
    );
  }
};

for (const artifactName of webHostArtifacts) {
  verifyChecksum(path.join(repoRoot, "packages/openducktor-web/bin", artifactName));
}

for (const { manifestPath, manifest } of manifests) {
  const changed = rewriteWorkspaceDependencies(manifest);
  if (changed) {
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Prepared ${manifest.name} workspace dependencies for npm publish.`);
  } else {
    console.log(`${manifest.name} has no workspace dependencies to rewrite.`);
  }
}
