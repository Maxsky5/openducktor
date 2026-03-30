const normalizeSeparators = (path: string): string => path.replace(/\\+/g, "/");

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

  if (normalizedPath === normalizedWorkingDirectory) {
    return normalizedPath;
  }

  const workingDirectoryPrefix = normalizedWorkingDirectory.endsWith("/")
    ? normalizedWorkingDirectory
    : `${normalizedWorkingDirectory}/`;
  if (normalizedPath.startsWith(workingDirectoryPrefix)) {
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
  const normalizedPath = normalizeSeparators(path);
  const filePath = /^[A-Za-z]:\//.test(normalizedPath) ? `/${normalizedPath}` : normalizedPath;
  return `file://${encodeURI(filePath)}`;
};
