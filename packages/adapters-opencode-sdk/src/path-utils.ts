const normalizeSeparators = (path: string): string => path.replace(/\\+/g, "/");

const isWindowsDrivePath = (path: string): boolean => /^[A-Za-z]:\//.test(path);

const normalizePathForComparison = (path: string): string => {
  return isWindowsDrivePath(path) ? path.toLowerCase() : path;
};

const encodeFilePathForUrl = (path: string): string => {
  return path
    .split("/")
    .map((segment, index) => {
      if (segment.length === 0) {
        return index === 0 ? "" : segment;
      }
      return encodeURIComponent(segment);
    })
    .join("/")
    .replace(/^([A-Za-z])%3A\//, "$1:/");
};

const trimTrailingSeparators = (path: string): string => {
  const trimmed = path.replace(/\/+$/g, "");
  return trimmed.length > 0 ? trimmed : path;
};

export const isAbsolutePath = (path: string): boolean => {
  const normalized = normalizeSeparators(path.trim());
  return normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized);
};

export const basename = (path: string): string => {
  const normalized = trimTrailingSeparators(normalizeSeparators(path));
  const parts = normalized.split("/").filter((segment) => segment.length > 0);
  return parts[parts.length - 1] ?? "";
};

export const toProjectRelativePath = (path: string, workingDirectory: string): string => {
  const normalizedPath = trimTrailingSeparators(normalizeSeparators(path.trim()));
  const normalizedWorkingDirectory = trimTrailingSeparators(
    normalizeSeparators(workingDirectory.trim()),
  );
  if (!isAbsolutePath(normalizedPath)) {
    return normalizedPath;
  }

  if (normalizedWorkingDirectory.length === 0) {
    return normalizedPath;
  }

  const comparablePath = normalizePathForComparison(normalizedPath);
  const comparableWorkingDirectory = normalizePathForComparison(normalizedWorkingDirectory);

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
  const normalizedPath = normalizeSeparators(path.trim());
  if (isAbsolutePath(normalizedPath)) {
    return normalizedPath;
  }

  const normalizedWorkingDirectory = trimTrailingSeparators(
    normalizeSeparators(workingDirectory.trim()),
  );
  if (normalizedWorkingDirectory.length === 0) {
    return normalizedPath;
  }

  return `${normalizedWorkingDirectory}/${normalizedPath.replace(/^\.\//, "")}`;
};

export const toFileUrl = (path: string): string => {
  const normalizedPath = normalizeSeparators(path.trim());
  if (!isAbsolutePath(normalizedPath)) {
    throw new Error("OpenCode file URLs require an absolute path.");
  }

  const absolutePath = normalizedPath;

  if (isWindowsDrivePath(absolutePath)) {
    return `file:///${encodeFilePathForUrl(absolutePath)}`;
  }

  return `file://${encodeFilePathForUrl(absolutePath)}`;
};
