import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parse, stringify } from "yaml";

type MacUpdateManifestFile = {
  url?: unknown;
  [key: string]: unknown;
};

type MacUpdateManifest = {
  files?: unknown;
  path?: unknown;
  releaseDate?: unknown;
  sha512?: unknown;
  version?: unknown;
  [key: string]: unknown;
};

const MAC_MANIFEST_PATTERN = /^latest-mac(?:-[a-z0-9]+)?\.yml$/i;
const CANONICAL_MANIFEST_NAME = "latest-mac.yml";

const assertManifest = (value: unknown, fileName: string): MacUpdateManifest => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${fileName} is not a YAML object.`);
  }
  const manifest = value as MacUpdateManifest;
  if (!Array.isArray(manifest.files)) {
    throw new Error(`${fileName} does not contain a files list.`);
  }
  if (typeof manifest.version !== "string" || !manifest.version.trim()) {
    throw new Error(`${fileName} does not contain a release version.`);
  }
  return manifest;
};

const readManifest = async (
  assetsDirectory: string,
  fileName: string,
): Promise<MacUpdateManifest> =>
  assertManifest(parse(await readFile(join(assetsDirectory, fileName), "utf8")), fileName);

const fileUrl = (file: MacUpdateManifestFile): string | null =>
  typeof file.url === "string" && file.url.trim() ? file.url : null;

const archFromFileUrl = (url: string): "arm64" | "x64" | null => {
  if (url.includes("arm64")) {
    return "arm64";
  }
  if (url.includes("x64")) {
    return "x64";
  }
  return null;
};

export const mergeMacUpdateManifests = async (assetsDirectory: string): Promise<string | null> => {
  const entries = await readdir(assetsDirectory, { withFileTypes: true });
  const manifestNames = entries
    .filter((entry) => entry.isFile() && MAC_MANIFEST_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  if (manifestNames.length === 0) {
    return null;
  }

  const canonicalName = manifestNames.includes(CANONICAL_MANIFEST_NAME)
    ? CANONICAL_MANIFEST_NAME
    : manifestNames[0];
  if (!canonicalName) {
    return null;
  }
  const canonical = await readManifest(assetsDirectory, canonicalName);
  const filesByUrl = new Map<string, MacUpdateManifestFile>();

  for (const manifestName of manifestNames) {
    const manifest = await readManifest(assetsDirectory, manifestName);
    if (manifest.version !== canonical.version) {
      throw new Error(
        `Cannot merge macOS update manifests with different versions: ${canonical.version} and ${manifest.version}.`,
      );
    }
    for (const file of manifest.files as MacUpdateManifestFile[]) {
      const url = fileUrl(file);
      if (!url) {
        throw new Error(`${manifestName} contains an update file without a url.`);
      }
      filesByUrl.set(url, file);
    }
  }

  const mergedFiles = [...filesByUrl.values()].sort((left, right) =>
    String(left.url).localeCompare(String(right.url)),
  );
  const presentArchitectures = new Set(
    mergedFiles.map((file) => fileUrl(file)).map((url) => (url ? archFromFileUrl(url) : null)),
  );
  const hasArm64Artifact = entries.some(
    (entry) => entry.isFile() && entry.name.includes("mac-arm64"),
  );
  const hasX64Artifact = entries.some((entry) => entry.isFile() && entry.name.includes("mac-x64"));
  if (hasArm64Artifact && hasX64Artifact) {
    if (!presentArchitectures.has("arm64") || !presentArchitectures.has("x64")) {
      throw new Error("Canonical latest-mac.yml must include both arm64 and x64 update files.");
    }
  }

  const merged: MacUpdateManifest = {
    ...canonical,
    files: mergedFiles,
  };

  const canonicalPath = join(assetsDirectory, CANONICAL_MANIFEST_NAME);
  await writeFile(canonicalPath, stringify(merged), "utf8");

  for (const manifestName of manifestNames) {
    if (manifestName !== CANONICAL_MANIFEST_NAME) {
      await rm(join(assetsDirectory, manifestName), { force: true });
    }
  }

  return canonicalPath;
};

if (import.meta.main) {
  const assetsDirectory = process.argv[2];
  if (!assetsDirectory) {
    console.error(
      "Usage: bun run apps/electron/scripts/merge-mac-update-manifests.ts <assets-dir>",
    );
    process.exit(1);
  }

  await mergeMacUpdateManifests(assetsDirectory)
    .then((mergedPath) => {
      if (mergedPath) {
        console.log(`Merged macOS update manifest: ${basename(mergedPath)}`);
      } else {
        console.log("No macOS update manifests found to merge.");
      }
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
