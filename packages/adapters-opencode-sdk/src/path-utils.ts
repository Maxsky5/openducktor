import {
  basenameForPath,
  isAbsolutePath,
  normalizePathSeparators,
  resolveAgainstWorkingDirectory,
  toProjectRelativePath,
  trimTrailingPathSeparators,
} from "@openducktor/path-support";

export {
  isAbsolutePath,
  normalizePathSeparators,
  resolveAgainstWorkingDirectory,
  toProjectRelativePath,
  trimTrailingPathSeparators,
};

export const basename = basenameForPath;

const isWindowsDrivePath = (path: string): boolean => /^[A-Za-z]:\//.test(path);

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

export const toFileUrl = (path: string): string => {
  const normalizedPath = normalizePathSeparators(path.trim());
  if (!isAbsolutePath(normalizedPath)) {
    throw new Error("OpenCode file URLs require an absolute path.");
  }

  const absolutePath = normalizedPath;

  if (isWindowsDrivePath(absolutePath)) {
    return `file:///${encodeFilePathForUrl(absolutePath)}`;
  }

  return `file://${encodeFilePathForUrl(absolutePath)}`;
};
