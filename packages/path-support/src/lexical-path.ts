const WINDOWS_DRIVE_PATH_PATTERN = /^[A-Za-z]:(?:[\\/]|$)/;
const WINDOWS_DRIVE_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
const WINDOWS_DRIVE_ROOT_PATTERN = /^[A-Za-z]:[\\/]$/;

export const normalizePathSeparators = (path: string): string => path.replace(/\\+/g, "/");

export const trimTrailingPathSeparators = (path: string): string => {
  if (path === "/" || path === "\\" || WINDOWS_DRIVE_ROOT_PATTERN.test(path)) {
    return path;
  }
  const trimmed = path.replace(/[\\/]+$/g, "");
  return trimmed.length > 0 ? trimmed : path;
};

export const isAbsolutePath = (path: string): boolean => {
  const normalized = normalizePathSeparators(path.trim());
  return normalized.startsWith("/") || WINDOWS_DRIVE_ABSOLUTE_PATH_PATTERN.test(normalized);
};

export const basenameForPath = (path: string): string => {
  const normalized = trimTrailingPathSeparators(normalizePathSeparators(path));
  const parts = normalized.split("/").filter((segment) => segment.length > 0);
  return parts[parts.length - 1] ?? "";
};

export const normalizePathForComparison = (value: string): string => {
  const trimmed = value.trim();
  const leadingSeparatorRoot = /^[\\/]/.test(trimmed);
  const windowsDrivePath = WINDOWS_DRIVE_PATH_PATTERN.test(trimmed);
  const segments: string[] = [];
  const minimumSegments = windowsDrivePath ? 1 : 0;
  for (const segment of trimmed.split(/[\\/]+/)) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (segments.length > minimumSegments) {
        segments.pop();
      }
      continue;
    }
    segments.push(segment);
  }
  const comparable = leadingSeparatorRoot ? `/${segments.join("/")}` : segments.join("/");
  return windowsDrivePath ? comparable.toLowerCase() : comparable;
};

export const pathStartsWith = (child: string, parent: string): boolean => {
  const normalizedChild = normalizePathForComparison(child);
  const normalizedParent = normalizePathForComparison(parent);
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}/`);
};

const normalizePathForPrefixComparison = (path: string): string => {
  return WINDOWS_DRIVE_ABSOLUTE_PATH_PATTERN.test(path) ? path.toLowerCase() : path;
};

export const toProjectRelativePath = (path: string, workingDirectory: string): string => {
  const normalizedPath = trimTrailingPathSeparators(normalizePathSeparators(path.trim()));
  const normalizedWorkingDirectory = trimTrailingPathSeparators(
    normalizePathSeparators(workingDirectory.trim()),
  );
  if (!isAbsolutePath(normalizedPath)) {
    return normalizedPath;
  }

  if (normalizedWorkingDirectory.length === 0) {
    return normalizedPath;
  }

  const comparablePath = normalizePathForPrefixComparison(normalizedPath);
  const comparableWorkingDirectory = normalizePathForPrefixComparison(normalizedWorkingDirectory);

  if (comparablePath === comparableWorkingDirectory) {
    return normalizedPath;
  }

  const workingDirectoryPrefix = normalizedWorkingDirectory.endsWith("/")
    ? normalizedWorkingDirectory
    : `${normalizedWorkingDirectory}/`;
  const comparableWorkingDirectoryPrefix = comparableWorkingDirectory.endsWith("/")
    ? comparableWorkingDirectory
    : `${comparableWorkingDirectory}/`;
  if (comparablePath.startsWith(comparableWorkingDirectoryPrefix)) {
    return normalizedPath.slice(workingDirectoryPrefix.length);
  }

  return normalizedPath;
};

export const resolveAgainstWorkingDirectory = (workingDirectory: string, path: string): string => {
  const normalizedPath = normalizePathSeparators(path.trim());
  if (isAbsolutePath(normalizedPath)) {
    return normalizedPath;
  }

  const normalizedWorkingDirectory = trimTrailingPathSeparators(
    normalizePathSeparators(workingDirectory.trim()),
  );
  if (normalizedWorkingDirectory.length === 0) {
    return normalizedPath;
  }

  return `${normalizedWorkingDirectory}/${normalizedPath.replace(/^\.\//, "")}`;
};

export const toDisplayRelativePath = (path: string, workingDirectory?: string | null): string => {
  const trimmedPath = path.trim();
  const trimmedWorkingDirectory = workingDirectory?.trim() ?? "";
  if (trimmedPath.length === 0 || trimmedWorkingDirectory.length === 0) {
    return trimmedPath;
  }

  if (
    normalizePathForComparison(trimmedPath) === normalizePathForComparison(trimmedWorkingDirectory)
  ) {
    return ".";
  }

  const projectRelativePath = toProjectRelativePath(trimmedPath, trimmedWorkingDirectory);
  const normalizedTrimmedPath = trimTrailingPathSeparators(normalizePathSeparators(trimmedPath));
  if (projectRelativePath === normalizedTrimmedPath) {
    return trimmedPath;
  }

  return projectRelativePath;
};
