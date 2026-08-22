import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

type PackageManifest = {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
};

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
// SAFETY: JSON.parse can only produce JSON data, which satisfies `PackageManifest` at this boundary.
const hostManifest = JSON.parse(readFileSync(hostManifestPath, "utf8")) as PackageManifest;
const opencodeAdapterManifestPath = path.join(
  repoRoot,
  "packages/adapters-opencode-sdk/package.json",
);
// SAFETY: JSON.parse can only produce JSON data, which satisfies `PackageManifest` at this boundary.
const opencodeAdapterManifest = JSON.parse(
  readFileSync(opencodeAdapterManifestPath, "utf8"),
) as PackageManifest;
const packageRoot = path.join(repoRoot, "packages/openducktor-web");
const manifestPath = path.join(packageRoot, "package.json");
// SAFETY: JSON.parse can only produce JSON data, which satisfies `PackageManifest` at this boundary.
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
const runtimeDependencySources = [
  {
    name: "@anthropic-ai/claude-agent-sdk",
    manifest: hostManifest,
    manifestPath: hostManifestPath,
  },
  {
    name: "undici",
    manifest: opencodeAdapterManifest,
    manifestPath: opencodeAdapterManifestPath,
  },
] as const;
// SAFETY: The surrounding boundary constructs or validates every member required by `Record<(typeof runtimeDependencySources)[number]["name"], string>`.
const allowedRuntimeDependencies = Object.fromEntries(
  runtimeDependencySources.map(({ name, manifest: sourceManifest, manifestPath: sourcePath }) => {
    const dependencyVersion = sourceManifest.dependencies?.[name];
    if (!dependencyVersion) {
      throw new Error(`Expected ${sourcePath} to depend on ${name}.`);
    }
    return [name, dependencyVersion];
  }),
) as Record<(typeof runtimeDependencySources)[number]["name"], string>;

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
