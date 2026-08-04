import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

type PackageManifest = {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
};

const runtimeDependencyNames = ["@anthropic-ai/claude-agent-sdk"] as const;

const expectedPackageFiles = [
  "dist/cli.js",
  "dist/openducktor-mcp.js",
  "dist/web-shell/index.html",
] as const;

const version = process.argv[2]?.trim();

if (
  !version ||
  !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$/.test(version)
) {
  throw new Error("Usage: bun run scripts/prepare-web-publish-packages.ts <semver-version>");
}

const repoRoot = path.resolve(import.meta.dir, "..");
const hostManifestPath = path.join(repoRoot, "packages/host/package.json");
const hostManifest = JSON.parse(readFileSync(hostManifestPath, "utf8")) as PackageManifest;
const packageRoot = path.join(repoRoot, "packages/openducktor-web");
const manifestPath = path.join(packageRoot, "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
const allowedRuntimeDependencies = Object.fromEntries(
  runtimeDependencyNames.map((dependencyName) => {
    const dependencyVersion = hostManifest.dependencies?.[dependencyName];
    if (!dependencyVersion) {
      throw new Error(`Expected ${hostManifestPath} to depend on ${dependencyName}.`);
    }
    return [dependencyName, dependencyVersion];
  }),
) as Record<(typeof runtimeDependencyNames)[number], string>;

if (manifest.name !== "@openducktor/web") {
  throw new Error(`Expected ${manifestPath} to describe @openducktor/web.`);
}
if (manifest.version !== version) {
  throw new Error(
    `@openducktor/web version ${manifest.version} does not match release version ${version}.`,
  );
}
if (JSON.stringify(manifest.dependencies ?? {}) !== JSON.stringify(allowedRuntimeDependencies)) {
  throw new Error(
    `@openducktor/web dependencies must be exactly ${JSON.stringify(allowedRuntimeDependencies)}.`,
  );
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
