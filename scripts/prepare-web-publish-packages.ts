import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

type PackageManifest = {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
};

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

for (const relativePath of expectedPackageFiles) {
  assertFile(path.join(packageRoot, relativePath));
}

console.log("@openducktor/web package contents are ready for npm publish.");
