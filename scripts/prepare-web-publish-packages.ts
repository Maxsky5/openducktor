import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

type PackageManifest = {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
};

const webHostArtifacts = [
  "openducktor-web-host-darwin-arm64",
  "openducktor-web-host-darwin-x64",
] as const;

const mcpSidecarArtifacts = [
  "openducktor-mcp-darwin-arm64",
  "openducktor-mcp-darwin-x64",
] as const;

const expectedPackageFiles = ["dist/cli.js", "dist/web-shell/index.html"] as const;

const version = process.argv[2]?.trim();

if (!version || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error("Usage: bun run scripts/prepare-web-publish-packages.ts <semver-version>");
}

const repoRoot = path.resolve(import.meta.dir, "..");
const packageRoot = path.join(repoRoot, "packages/openducktor-web");
const manifestPath = path.join(packageRoot, "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;

if (manifest.name !== "@openducktor/web") {
  throw new Error(`Expected ${manifestPath} to describe @openducktor/web.`);
}
if (manifest.version !== version) {
  throw new Error(`@openducktor/web version ${manifest.version} does not match release version ${version}.`);
}
if (manifest.dependencies && Object.keys(manifest.dependencies).length > 0) {
  throw new Error("@openducktor/web must be self-contained at runtime and publish without dependencies.");
}

const assertFile = (filePath: string): void => {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    throw new Error(`Missing required @openducktor/web package file: ${filePath}`);
  }
};

const verifyChecksum = (binaryPath: string, label: string): void => {
  assertFile(binaryPath);
  if (process.platform !== "win32" && (statSync(binaryPath).mode & 0o111) === 0) {
    throw new Error(`${label} is not executable: ${binaryPath}`);
  }

  const checksumPath = `${binaryPath}.sha256`;
  assertFile(checksumPath);

  const expected = readFileSync(checksumPath, "utf8").trim().split(/\s+/)[0];
  const actual = createHash("sha256").update(readFileSync(binaryPath)).digest("hex");
  if (actual !== expected) {
    throw new Error(
      `${label} checksum mismatch for ${binaryPath}. Expected ${expected}, received ${actual}.`,
    );
  }
};

for (const relativePath of expectedPackageFiles) {
  assertFile(path.join(packageRoot, relativePath));
}

for (const artifactName of webHostArtifacts) {
  verifyChecksum(path.join(packageRoot, "bin", artifactName), "OpenDucktor web host binary");
}

for (const artifactName of mcpSidecarArtifacts) {
  verifyChecksum(path.join(packageRoot, "bin", artifactName), "OpenDucktor MCP sidecar");
}

console.log("@openducktor/web package contents are ready for npm publish.");
