import { randomUUID } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { OpenInCommandRunner } from "./open-in-tools-adapter";

const MAX_OPEN_IN_ICON_DIMENSION = 256;

type ResolveMacOsAppIconInput = {
  appLabel: string;
  appPath: string;
  pathExists: (inputPath: string) => Promise<boolean>;
  runner: OpenInCommandRunner;
};

const iconFileName = (value: string): string => (value.endsWith(".icns") ? value : `${value}.icns`);

const readBundleIconFile = async ({
  appPath,
  pathExists,
  runner,
}: Omit<ResolveMacOsAppIconInput, "appLabel">): Promise<string | null> => {
  const infoPlistPath = path.posix.join(appPath, "Contents", "Info.plist");
  if (!(await pathExists(infoPlistPath))) {
    return null;
  }

  const output = await runner("defaults", ["read", infoPlistPath, "CFBundleIconFile"]).catch(
    () => null,
  );
  const iconName = output?.stdout.trim();
  return iconName ? iconFileName(iconName) : null;
};

const resolveMetadataIconFile = async ({
  appPath,
  runner,
}: Pick<ResolveMacOsAppIconInput, "appPath" | "runner">): Promise<string | null> => {
  const output = await runner("mdls", ["-name", "kMDItemIconFile", "-raw", appPath]).catch(
    () => null,
  );
  const iconName = output?.stdout.trim();
  if (!iconName || iconName === "(null)") {
    return null;
  }

  return iconFileName(iconName);
};

const findFirstResourceIcon = async (resourcesPath: string): Promise<string | null> => {
  const entries = await readdir(resourcesPath).catch(() => []);
  return entries.find((entry) => path.extname(entry).toLowerCase() === ".icns") ?? null;
};

const resolveAppIconPath = async ({
  appPath,
  pathExists,
  runner,
}: Omit<ResolveMacOsAppIconInput, "appLabel">): Promise<string | null> => {
  if (!(await pathExists(appPath))) {
    return null;
  }

  const resourcesPath = path.posix.join(appPath, "Contents", "Resources");
  const iconFile =
    (await readBundleIconFile({ appPath, pathExists, runner })) ??
    (await resolveMetadataIconFile({ appPath, runner })) ??
    (await findFirstResourceIcon(resourcesPath));
  if (!iconFile) {
    return null;
  }

  const iconPath = path.posix.join(resourcesPath, iconFile);
  return (await pathExists(iconPath)) ? iconPath : null;
};

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

const resolveBestIconsetRepresentation = async (
  iconsetDirectory: string,
): Promise<string | null> => {
  const entries = await readdir(iconsetDirectory).catch(() => []);
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
};

const extractBestPngFromIconset = async ({
  appLabel,
  iconPath,
  runner,
}: Pick<ResolveMacOsAppIconInput, "appLabel" | "runner"> & {
  iconPath: string;
}): Promise<Buffer | null> => {
  const iconsetDirectory = tempIconOutputPath(appLabel, "iconset");

  try {
    await runner("iconutil", ["-c", "iconset", iconPath, "-o", iconsetDirectory]);
    const bestIconPath = await resolveBestIconsetRepresentation(iconsetDirectory);
    return bestIconPath ? await readFile(bestIconPath) : null;
  } catch {
    return null;
  } finally {
    await rm(iconsetDirectory, { force: true, recursive: true });
  }
};

const convertIconToPng = async ({
  appLabel,
  iconPath,
  runner,
}: Pick<ResolveMacOsAppIconInput, "appLabel" | "runner"> & {
  iconPath: string;
}): Promise<Buffer | null> => {
  const outputPath = tempIconOutputPath(appLabel, "png");

  try {
    await runner("sips", ["-s", "format", "png", "-Z", "256", iconPath, "--out", outputPath]);
    return await readFile(outputPath);
  } catch {
    return null;
  } finally {
    await rm(outputPath, { force: true });
  }
};

const iconBytesToDataUrl = (bytes: Buffer): string | null => {
  if (bytes.length === 0) {
    return null;
  }

  return `data:image/png;base64,${bytes.toString("base64")}`;
};

export const resolveMacOsAppIconDataUrl = async (
  input: ResolveMacOsAppIconInput,
): Promise<string | null> => {
  const iconPath = await resolveAppIconPath(input);
  if (!iconPath) {
    return null;
  }

  const bytes =
    (await extractBestPngFromIconset({ ...input, iconPath })) ??
    (await convertIconToPng({ ...input, iconPath }));
  return bytes ? iconBytesToDataUrl(bytes) : null;
};
