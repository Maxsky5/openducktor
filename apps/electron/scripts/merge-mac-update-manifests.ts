import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Effect } from "effect";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { runElectronEffect } from "../src/effect/electron-boundary";
import {
  ElectronOperationError,
  ElectronValidationError,
  errorMessage,
} from "../src/effect/electron-errors";
import {
  createMacUpdateManifestPattern,
  defaultElectronUpdateChannel,
  detectMacUpdateArtifactArchFromUrl,
  getCanonicalMacUpdateManifestName,
} from "./electron-release-artifacts";

const manifestObjectSchema = z.looseObject({
  files: z.unknown().optional(),
  version: z.unknown().optional(),
});
const manifestFileSchema = z.looseObject({ url: z.unknown().optional() });
const manifestFilesSchema = z.array(z.unknown());
const nonBlankStringSchema = z.string().refine((value) => value.trim().length > 0);

type MacUpdateManifestFile = z.output<typeof manifestFileSchema>;
type ValidatedMacUpdateManifestFile = Omit<MacUpdateManifestFile, "url"> & { url: string };
type MacUpdateManifest = Omit<z.output<typeof manifestObjectSchema>, "files" | "version"> & {
  files: z.output<typeof manifestFilesSchema>;
  version: string;
};

const parseManifest = (
  parsedObject: ReturnType<typeof manifestObjectSchema.safeParse>,
  fileName: string,
): Effect.Effect<MacUpdateManifest, ElectronValidationError> => {
  if (!parsedObject.success) {
    return Effect.fail(
      new ElectronValidationError({
        operation: "electron.package.parse-mac-update-manifest",
        message: `${fileName} is not a YAML object.`,
        field: "manifest",
        cause: parsedObject.error,
      }),
    );
  }
  const parsedFiles = manifestFilesSchema.safeParse(parsedObject.data.files);
  if (!parsedFiles.success) {
    return Effect.fail(
      new ElectronValidationError({
        operation: "electron.package.parse-mac-update-manifest",
        message: `${fileName} does not contain a files list.`,
        field: "files",
        cause: parsedFiles.error,
      }),
    );
  }
  const parsedVersion = nonBlankStringSchema.safeParse(parsedObject.data.version);
  if (!parsedVersion.success) {
    return Effect.fail(
      new ElectronValidationError({
        operation: "electron.package.parse-mac-update-manifest",
        message: `${fileName} does not contain a release version.`,
        field: "version",
        cause: parsedVersion.error,
      }),
    );
  }
  return Effect.succeed({
    ...parsedObject.data,
    files: parsedFiles.data,
    version: parsedVersion.data,
  });
};

const readManifest = (
  assetsDirectory: string,
  fileName: string,
): Effect.Effect<MacUpdateManifest, ElectronOperationError | ElectronValidationError> =>
  Effect.gen(function* () {
    const manifestPath = join(assetsDirectory, fileName);
    const source = yield* Effect.tryPromise({
      try: () => readFile(manifestPath, "utf8"),
      catch: (cause) =>
        new ElectronOperationError({
          operation: "electron.package.read-mac-update-manifest",
          message: errorMessage(cause),
          path: manifestPath,
          cause,
        }),
    });
    const parsedYaml = yield* Effect.try({
      try: () => parse(source),
      catch: (cause) =>
        new ElectronValidationError({
          operation: "electron.package.parse-mac-update-manifest",
          message: errorMessage(cause),
          field: "manifest",
          cause,
        }),
    });
    return yield* parseManifest(manifestObjectSchema.safeParse(parsedYaml), fileName);
  });

const validateManifestFile = (
  parsedFile: ReturnType<typeof manifestFileSchema.safeParse>,
  manifestName: string,
): Effect.Effect<ValidatedMacUpdateManifestFile, ElectronValidationError> => {
  if (!parsedFile.success) {
    return Effect.fail(
      new ElectronValidationError({
        operation: "electron.package.parse-mac-update-manifest-file",
        message: `${manifestName} contains an update file without a url.`,
        field: "url",
        cause: parsedFile.error,
      }),
    );
  }
  const parsedUrl = nonBlankStringSchema.safeParse(parsedFile.data.url);
  if (!parsedUrl.success) {
    return Effect.fail(
      new ElectronValidationError({
        operation: "electron.package.parse-mac-update-manifest-file",
        message: `${manifestName} contains an update file without a url.`,
        field: "url",
        cause: parsedUrl.error,
      }),
    );
  }
  return Effect.succeed({ ...parsedFile.data, url: parsedUrl.data });
};

const mergeMacUpdateManifestsEffect = (
  assetsDirectory: string,
  updateChannel = defaultElectronUpdateChannel,
): Effect.Effect<string | null, ElectronOperationError | ElectronValidationError> =>
  Effect.gen(function* () {
    const entries = yield* Effect.tryPromise({
      try: () => readdir(assetsDirectory, { withFileTypes: true }),
      catch: (cause) =>
        new ElectronOperationError({
          operation: "electron.package.read-mac-update-assets",
          message: errorMessage(cause),
          path: assetsDirectory,
          cause,
        }),
    });
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
    const canonical = yield* readManifest(assetsDirectory, canonicalName);
    const filesByUrl = new Map<string, ValidatedMacUpdateManifestFile>();

    for (const manifestName of manifestNames) {
      const manifest = yield* readManifest(assetsDirectory, manifestName);
      if (manifest.version !== canonical.version) {
        return yield* Effect.fail(
          new ElectronValidationError({
            operation: "electron.package.merge-mac-update-manifests",
            message: `Cannot merge macOS update manifests with different versions: ${canonical.version} and ${manifest.version}.`,
            field: "version",
          }),
        );
      }
      for (const file of manifest.files) {
        const validatedFile = yield* validateManifestFile(
          manifestFileSchema.safeParse(file),
          manifestName,
        );
        filesByUrl.set(validatedFile.url, validatedFile);
      }
    }

    const mergedFiles = [...filesByUrl.values()].sort((left, right) =>
      left.url.localeCompare(right.url),
    );
    const presentArchitectures = new Set(
      mergedFiles.map((file) => detectMacUpdateArtifactArchFromUrl(file.url)),
    );
    const hasArm64Artifact = entries.some(
      (entry) => entry.isFile() && entry.name.includes("mac-arm64"),
    );
    const hasX64Artifact = entries.some(
      (entry) => entry.isFile() && entry.name.includes("mac-x64"),
    );
    if (hasArm64Artifact && hasX64Artifact) {
      if (!presentArchitectures.has("arm64") || !presentArchitectures.has("x64")) {
        return yield* Effect.fail(
          new ElectronValidationError({
            operation: "electron.package.merge-mac-update-manifests",
            message: `Canonical ${canonicalMacUpdateManifestName} must include both arm64 and x64 update files.`,
            field: "files",
          }),
        );
      }
    }

    const merged: MacUpdateManifest = {
      ...canonical,
      files: mergedFiles,
    };

    const canonicalPath = join(assetsDirectory, canonicalMacUpdateManifestName);
    yield* Effect.tryPromise({
      try: () => writeFile(canonicalPath, stringify(merged), "utf8"),
      catch: (cause) =>
        new ElectronOperationError({
          operation: "electron.package.write-mac-update-manifest",
          message: errorMessage(cause),
          path: canonicalPath,
          cause,
        }),
    });

    for (const manifestName of manifestNames) {
      if (manifestName !== canonicalMacUpdateManifestName) {
        const manifestPath = join(assetsDirectory, manifestName);
        yield* Effect.tryPromise({
          try: () => rm(manifestPath, { force: true }),
          catch: (cause) =>
            new ElectronOperationError({
              operation: "electron.package.remove-mac-update-manifest",
              message: errorMessage(cause),
              path: manifestPath,
              cause,
            }),
        });
      }
    }

    return canonicalPath;
  });

export const mergeMacUpdateManifests = (
  assetsDirectory: string,
  updateChannel = defaultElectronUpdateChannel,
): Promise<string | null> =>
  runElectronEffect(mergeMacUpdateManifestsEffect(assetsDirectory, updateChannel));

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
