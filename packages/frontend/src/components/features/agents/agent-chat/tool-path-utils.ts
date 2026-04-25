const normalizeSlashes = (value: string): string => value.replace(/\\/g, "/");
const DISPLAY_PATH_KEYS = new Set([
  "filePath",
  "file_path",
  "path",
  "paths",
  "file",
  "files",
  "filename",
  "cwd",
  "directory",
  "root",
  "basePath",
  "workingDir",
  "workingDirectory",
]);

const trimTrailingSlash = (value: string): string => {
  if (value === "/") {
    return value;
  }
  return value.replace(/\/+$/, "");
};

const normalizeAbsolutePath = (value: string): string => trimTrailingSlash(normalizeSlashes(value));

export const relativizeDisplayPath = (
  filePath: string,
  workingDirectory?: string | null,
): string => {
  const trimmedPath = filePath.trim();
  const trimmedWorkingDirectory = workingDirectory?.trim() ?? "";
  if (trimmedPath.length === 0 || trimmedWorkingDirectory.length === 0) {
    return trimmedPath;
  }

  const normalizedPath = normalizeAbsolutePath(trimmedPath);
  if (!normalizedPath.startsWith("/")) {
    return trimmedPath;
  }

  const normalizedWorkingDirectory = normalizeAbsolutePath(trimmedWorkingDirectory);
  if (normalizedPath === normalizedWorkingDirectory) {
    return ".";
  }
  if (!normalizedPath.startsWith(`${normalizedWorkingDirectory}/`)) {
    return trimmedPath;
  }

  return normalizedPath.slice(normalizedWorkingDirectory.length + 1);
};

export const relativizeSearchSummary = (
  summary: string,
  workingDirectory?: string | null,
): string => {
  const marker = " in ";
  const markerIndex = summary.lastIndexOf(marker);
  if (markerIndex === -1) {
    return relativizeDisplayPath(summary, workingDirectory);
  }

  const prefix = summary.slice(0, markerIndex + marker.length);
  const path = summary.slice(markerIndex + marker.length);
  return `${prefix}${relativizeDisplayPath(path, workingDirectory)}`;
};

export const relativizeDisplayPathsInValue = (
  value: unknown,
  workingDirectory?: string | null,
  key?: string,
): unknown => {
  if (typeof value === "string") {
    return key && DISPLAY_PATH_KEYS.has(key)
      ? relativizeDisplayPath(value, workingDirectory)
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => relativizeDisplayPathsInValue(entry, workingDirectory, key));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      relativizeDisplayPathsInValue(entryValue, workingDirectory, entryKey),
    ]),
  );
};
