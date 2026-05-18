import { randomUUID } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import {
  type HostOperationError,
  type HostPathAccessError,
  toHostOperationError,
} from "../../effect/host-errors";
import type { OpenInCommandRunner } from "./open-in-tools-adapter";

const MAX_OPEN_IN_ICON_DIMENSION = 256;

type ResolveMacOsAppIconInput = {
  appLabel: string;
  appPath: string;
  pathExists: (inputPath: string) => Effect.Effect<boolean, HostPathAccessError>;
  runner: OpenInCommandRunner;
};

const iconFileName = (value: string): string => (value.endsWith(".icns") ? value : `${value}.icns`);

const runIconCommand = (
  runner: OpenInCommandRunner,
  program: string,
  args: string[],
  operation: string,
) =>
  runner(program, args).pipe(
    Effect.mapError((cause) => toHostOperationError(cause, operation, { program, args })),
  );

const readDirectoryEntries = (directoryPath: string, operation: string) =>
  Effect.tryPromise({
    try: () => readdir(directoryPath),
    catch: (cause) => toHostOperationError(cause, operation, { directoryPath }),
  });

const readBinaryFile = (filePath: string, operation: string) =>
  Effect.tryPromise({
    try: () => readFile(filePath),
    catch: (cause) => toHostOperationError(cause, operation, { filePath }),
  });

const removePath = (targetPath: string, recursive = false) =>
  Effect.tryPromise({
    try: () => rm(targetPath, { force: true, recursive }),
    catch: (cause) => toHostOperationError(cause, "openInTools.icon.cleanup", { targetPath }),
  });

const readBundleIconFile = ({
  appPath,
  pathExists,
  runner,
}: Omit<ResolveMacOsAppIconInput, "appLabel">): Effect.Effect<
  string | null,
  HostOperationError | HostPathAccessError
> =>
  Effect.gen(function* () {
    const infoPlistPath = path.posix.join(appPath, "Contents", "Info.plist");
    if (!(yield* pathExists(infoPlistPath))) {
      return null;
    }

    const output = yield* runIconCommand(
      runner,
      "defaults",
      ["read", infoPlistPath, "CFBundleIconFile"],
      "openInTools.icon.readBundleIconFile",
    ).pipe(Effect.catchAll(() => Effect.succeed(null)));
    const iconName = output?.stdout.trim();
    return iconName ? iconFileName(iconName) : null;
  });

const resolveMetadataIconFile = ({
  appPath,
  runner,
}: Pick<ResolveMacOsAppIconInput, "appPath" | "runner">): Effect.Effect<
  string | null,
  HostOperationError
> =>
  Effect.gen(function* () {
    const output = yield* runIconCommand(
      runner,
      "mdls",
      ["-name", "kMDItemIconFile", "-raw", appPath],
      "openInTools.icon.resolveMetadataIconFile",
    ).pipe(Effect.catchAll(() => Effect.succeed(null)));
    const iconName = output?.stdout.trim();
    if (!iconName || iconName === "(null)") {
      return null;
    }

    return iconFileName(iconName);
  });

const findFirstResourceIcon = (
  resourcesPath: string,
): Effect.Effect<string | null, HostOperationError> =>
  Effect.gen(function* () {
    const entries = yield* readDirectoryEntries(
      resourcesPath,
      "openInTools.icon.findFirstResourceIcon",
    ).pipe(Effect.catchAll(() => Effect.succeed([])));
    return entries.find((entry) => path.extname(entry).toLowerCase() === ".icns") ?? null;
  });

const resolveAppIconPath = ({
  appPath,
  pathExists,
  runner,
}: Omit<ResolveMacOsAppIconInput, "appLabel">): Effect.Effect<
  string | null,
  HostOperationError | HostPathAccessError
> =>
  Effect.gen(function* () {
    if (!(yield* pathExists(appPath))) {
      return null;
    }

    const resourcesPath = path.posix.join(appPath, "Contents", "Resources");
    const bundleIconFile = yield* readBundleIconFile({ appPath, pathExists, runner });
    const metadataIconFile = bundleIconFile
      ? null
      : yield* resolveMetadataIconFile({ appPath, runner });
    const iconFile =
      bundleIconFile ?? metadataIconFile ?? (yield* findFirstResourceIcon(resourcesPath));
    if (!iconFile) {
      return null;
    }

    const iconPath = path.posix.join(resourcesPath, iconFile);
    return (yield* pathExists(iconPath)) ? iconPath : null;
  });

const sanitizedTempName = (value: string): string => {
  const sanitized = value.replaceAll(/[^a-zA-Z0-9]/g, "_");
  return sanitized.length > 0 ? sanitized : "app";
};

const tempIconOutputPath = (appLabel: string, extension: string): string => {
  return path.join(
    tmpdir(),
    `openducktor-open-in-icon-${sanitizedTempName(appLabel)}-${process.pid}-${randomUUID()}.${extension}`,
  );
};

export const iconsetRepresentationScore = (iconName: string): number | null => {
  const stem = iconName.endsWith(".png") ? iconName.slice(0, -".png".length) : null;
  if (!stem?.startsWith("icon_")) {
    return null;
  }

  const representation = stem.slice("icon_".length);
  const match = representation.match(/^(\d+)x(\d+)(?:@(\d+)x)?$/);
  if (!match) {
    return null;
  }

  const [, widthValue, heightValue, scaleValue] = match;
  const width = Number.parseInt(widthValue ?? "", 10);
  const height = Number.parseInt(heightValue ?? "", 10);
  const scale = scaleValue ? Number.parseInt(scaleValue, 10) : 1;
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(scale)) {
    return null;
  }

  const effectiveWidth = width * scale;
  const effectiveHeight = height * scale;
  if (effectiveWidth > MAX_OPEN_IN_ICON_DIMENSION || effectiveHeight > MAX_OPEN_IN_ICON_DIMENSION) {
    return null;
  }

  return effectiveWidth * effectiveHeight;
};

const resolveBestIconsetRepresentation = (
  iconsetDirectory: string,
): Effect.Effect<string | null, HostOperationError> =>
  Effect.gen(function* () {
    const entries = yield* readDirectoryEntries(
      iconsetDirectory,
      "openInTools.icon.resolveBestIconsetRepresentation",
    ).pipe(Effect.catchAll(() => Effect.succeed([])));
    let bestMatch: { path: string; score: number } | null = null;

    for (const entry of entries) {
      const score = iconsetRepresentationScore(entry);
      if (score === null) {
        continue;
      }

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = {
          path: path.join(iconsetDirectory, entry),
          score,
        };
      }
    }

    return bestMatch?.path ?? null;
  });

const extractBestPngFromIconset = ({
  appLabel,
  iconPath,
  runner,
}: Pick<ResolveMacOsAppIconInput, "appLabel" | "runner"> & {
  iconPath: string;
}): Effect.Effect<Buffer | null, HostOperationError> => {
  const iconsetDirectory = tempIconOutputPath(appLabel, "iconset");

  return Effect.gen(function* () {
    yield* runIconCommand(
      runner,
      "iconutil",
      ["-c", "iconset", iconPath, "-o", iconsetDirectory],
      "openInTools.icon.extractIconset",
    );
    const bestIconPath = yield* resolveBestIconsetRepresentation(iconsetDirectory);
    return bestIconPath
      ? yield* readBinaryFile(bestIconPath, "openInTools.icon.readIconsetRepresentation")
      : null;
  }).pipe(
    Effect.catchAll(() => Effect.succeed(null)),
    Effect.ensuring(removePath(iconsetDirectory, true).pipe(Effect.ignore)),
  );
};

const convertIconToPng = ({
  appLabel,
  iconPath,
  runner,
}: Pick<ResolveMacOsAppIconInput, "appLabel" | "runner"> & {
  iconPath: string;
}): Effect.Effect<Buffer | null, HostOperationError> => {
  const outputPath = tempIconOutputPath(appLabel, "png");

  return Effect.gen(function* () {
    yield* runIconCommand(
      runner,
      "sips",
      ["-s", "format", "png", "-Z", "256", iconPath, "--out", outputPath],
      "openInTools.icon.convertIconToPng",
    );
    return yield* readBinaryFile(outputPath, "openInTools.icon.readConvertedPng");
  }).pipe(
    Effect.catchAll(() => Effect.succeed(null)),
    Effect.ensuring(removePath(outputPath).pipe(Effect.ignore)),
  );
};

const iconBytesToDataUrl = (bytes: Buffer): string | null => {
  if (bytes.length === 0) {
    return null;
  }

  return `data:image/png;base64,${bytes.toString("base64")}`;
};

export const resolveMacOsAppIconDataUrl = (
  input: ResolveMacOsAppIconInput,
): Effect.Effect<string | null, HostOperationError | HostPathAccessError> =>
  Effect.gen(function* () {
    const iconPath = yield* resolveAppIconPath(input);
    if (!iconPath) {
      return null;
    }

    const iconsetBytes = yield* extractBestPngFromIconset({ ...input, iconPath });
    const bytes = iconsetBytes ?? (yield* convertIconToPng({ ...input, iconPath }));
    return bytes ? iconBytesToDataUrl(bytes) : null;
  });
