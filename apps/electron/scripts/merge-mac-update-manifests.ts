import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import {
  createMacUpdateManifestPattern,
  defaultElectronUpdateChannel,
  detectMacUpdateArtifactArchFromUrl,
  getCanonicalMacUpdateManifestName,
} from "./electron-release-artifacts";

const nonBlankString = z.string().refine((value) => value.trim().length > 0, {
  message: "must not be blank",
});

const macUpdateManifestFileSchema = z.looseObject({
  url: nonBlankString,
  sha512: z.string().optional(),
  size: z.number().finite().nonnegative().optional(),
  blockMapSize: z.number().finite().nonnegative().optional(),
});

const macUpdateManifestSchema = z.looseObject({
  version: nonBlankString,
  files: z.array(macUpdateManifestFileSchema),
  path: z.string().optional(),
  sha512: z.string().optional(),
  releaseDate: z.string().optional(),
  stagingPercentage: z.number().finite().min(0).max(100).optional(),
});

type MacUpdateManifest = z.infer<typeof macUpdateManifestSchema>;
type MacUpdateManifestFile = z.infer<typeof macUpdateManifestFileSchema>;

const readManifest = async (
  assetsDirectory: string,
  fileName: string,
): Promise<MacUpdateManifest> => {
  const parsedManifest = macUpdateManifestSchema.safeParse(
    parse(await readFile(join(assetsDirectory, fileName), "utf8")),
  );
  if (parsedManifest.success) {
    return parsedManifest.data;
  }

  const issues = parsedManifest.error.issues
    .map((issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`)
    .join("; ");
  throw new Error(`${fileName} is not a valid macOS update manifest: ${issues}.`);
};

export const mergeMacUpdateManifests = async (
  assetsDirectory: string,
  updateChannel = defaultElectronUpdateChannel,
): Promise<string | null> => {
  const entries = await readdir(assetsDirectory, { withFileTypes: true });
  const canonicalMacUpdateManifestName = getCanonicalMacUpdateManifestName(updateChannel);
  const macUpdateManifestPattern = createMacUpdateManifestPattern(updateChannel);
  const manifestNames = entries
    .filter((entry) => entry.isFile() && macUpdateManifestPattern.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  if (manifestNames.length === 0) {
    return null;
  }

  const firstManifestName = manifestNames.reduce((firstName) => firstName);
  const canonicalName = manifestNames.includes(canonicalMacUpdateManifestName)
    ? canonicalMacUpdateManifestName
    : firstManifestName;
  const canonical = await readManifest(assetsDirectory, canonicalName);
  const filesByUrl = new Map<string, MacUpdateManifestFile>();

  for (const manifestName of manifestNames) {
    const manifest = await readManifest(assetsDirectory, manifestName);
    if (manifest.version !== canonical.version) {
      throw new Error(
        `Cannot merge macOS update manifests with different versions: ${canonical.version} and ${manifest.version}.`,
      );
    }
    for (const file of manifest.files) {
      filesByUrl.set(file.url, file);
    }
  }

  const mergedFiles = [...filesByUrl.values()].sort((left, right) =>
    String(left.url).localeCompare(String(right.url)),
  );
  const presentArchitectures = new Set(
    mergedFiles.map((file) => detectMacUpdateArtifactArchFromUrl(file.url)),
  );
  const hasArm64Artifact = entries.some(
    (entry) => entry.isFile() && entry.name.includes("mac-arm64"),
  );
  const hasX64Artifact = entries.some((entry) => entry.isFile() && entry.name.includes("mac-x64"));
  if (hasArm64Artifact && hasX64Artifact) {
    if (!presentArchitectures.has("arm64") || !presentArchitectures.has("x64")) {
      throw new Error(
        `Canonical ${canonicalMacUpdateManifestName} must include both arm64 and x64 update files.`,
      );
    }
  }

  const merged: MacUpdateManifest = {
    ...canonical,
    files: mergedFiles,
  };

  const canonicalPath = join(assetsDirectory, canonicalMacUpdateManifestName);
  await writeFile(canonicalPath, stringify(merged), "utf8");

  for (const manifestName of manifestNames) {
    if (manifestName !== canonicalMacUpdateManifestName) {
      await rm(join(assetsDirectory, manifestName), { force: true });
    }
  }

  return canonicalPath;
};

if (import.meta.main) {
  const assetsDirectory = process.argv[2];
  const updateChannel = process.argv[3] ?? defaultElectronUpdateChannel;
  if (!assetsDirectory) {
    console.error(
      "Usage: bun run apps/electron/scripts/merge-mac-update-manifests.ts <assets-dir> [update-channel]",
    );
    process.exit(1);
  }

  await mergeMacUpdateManifests(assetsDirectory, updateChannel)
    .then((mergedPath) => {
      if (mergedPath) {
        console.log(`Merged macOS update manifest: ${basename(mergedPath)}`);
      } else {
        console.log("No macOS update manifests found to merge.");
      }
    })
    .catch((cause: unknown) => {
      console.error(cause);
      process.exit(1);
    });
}
