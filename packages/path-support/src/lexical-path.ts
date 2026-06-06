const WINDOWS_DRIVE_PATH_PATTERN = /^[A-Za-z]:(?:[\\/]|$)/;
const WINDOWS_DRIVE_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
const WINDOWS_DRIVE_ROOT_PATTERN = /^[A-Za-z]:[\\/]$/;

type LexicalPath = {
  path: string;
  comparisonPath: string;
};

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

const toLexicalPath = (
  value: string,
  { preserveLeadingParents }: { preserveLeadingParents: boolean },
): LexicalPath => {
  const trimmed = value.trim();
  const hasTrailingSeparator = /[\\/]$/.test(trimmed);
  const leadingSeparatorRoot = /^[\\/]/.test(trimmed);
  const windowsDrivePath = WINDOWS_DRIVE_PATH_PATTERN.test(trimmed);
  const segments: string[] = [];
  const minimumSegments = windowsDrivePath ? 1 : 0;
  for (const segment of trimmed.split(/[\\/]+/)) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (segments.length > minimumSegments && segments[segments.length - 1] !== "..") {
        segments.pop();
      } else if (preserveLeadingParents && !leadingSeparatorRoot && !windowsDrivePath) {
        segments.push(segment);
      }
      continue;
    }
    segments.push(segment);
  }
  const joined = segments.join("/");
  const sourceWasDriveAbsolute = WINDOWS_DRIVE_ABSOLUTE_PATH_PATTERN.test(trimmed);
  const isWindowsDriveRoot =
    windowsDrivePath &&
    segments.length === 1 &&
    /^[A-Za-z]:$/.test(segments[0] ?? "") &&
    (hasTrailingSeparator || sourceWasDriveAbsolute);
  const path = leadingSeparatorRoot ? `/${joined}` : isWindowsDriveRoot ? `${joined}/` : joined;
  return {
    path,
    comparisonPath: windowsDrivePath ? path.toLowerCase() : path,
  };
};

export const normalizePathForComparison = (value: string): string =>
  toLexicalPath(value, { preserveLeadingParents: false }).comparisonPath;

const normalizePathForContainment = (value: string): LexicalPath =>
  toLexicalPath(value, { preserveLeadingParents: true });

export const pathStartsWith = (child: string, parent: string): boolean => {
  const normalizedChild = normalizePathForContainment(child).comparisonPath;
  const normalizedParent = normalizePathForContainment(parent).comparisonPath;
  if (normalizedParent.length === 0) {
    return false;
  }
  if (normalizedChild === normalizedParent) {
    return true;
  }
  const parentPrefix = normalizedParent.endsWith("/") ? normalizedParent : `${normalizedParent}/`;
  return normalizedChild.startsWith(parentPrefix);
};

export const toProjectRelativePath = (path: string, workingDirectory: string): string => {
  const normalizedPath = trimTrailingPathSeparators(normalizePathSeparators(path.trim()));
  const normalizedWorkingDirectory = trimTrailingPathSeparators(
    normalizePathSeparators(workingDirectory.trim()),
  );
  if (!isAbsolutePath(normalizedPath)) {
    return normalizedPath;
  }

  const lexicalPath = normalizePathForContainment(normalizedPath);
  if (normalizedWorkingDirectory.length === 0) {
    return lexicalPath.path;
  }

  const lexicalWorkingDirectory = normalizePathForContainment(normalizedWorkingDirectory);

  if (lexicalPath.comparisonPath === lexicalWorkingDirectory.comparisonPath) {
    return lexicalPath.path;
  }

  const comparableWorkingDirectoryPrefix = lexicalWorkingDirectory.comparisonPath.endsWith("/")
    ? lexicalWorkingDirectory.comparisonPath
    : `${lexicalWorkingDirectory.comparisonPath}/`;
  if (lexicalPath.comparisonPath.startsWith(comparableWorkingDirectoryPrefix)) {
    const workingDirectoryPrefixLength = lexicalWorkingDirectory.path.endsWith("/")
      ? lexicalWorkingDirectory.path.length
      : lexicalWorkingDirectory.path.length + 1;
    return lexicalPath.path.slice(workingDirectoryPrefixLength);
  }

  return lexicalPath.path;
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
    normalizePathForContainment(trimmedPath).comparisonPath ===
    normalizePathForContainment(trimmedWorkingDirectory).comparisonPath
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
