import type { CanonicalPathPlatform } from "@openducktor/path-support";

/**
 * Compares canonical paths by their exact names. POSIX paths stay byte for byte, so a trailing
 * space or a backslash is part of the name. Windows keeps the letter case too, because a
 * directory can be case sensitive. Canonical Windows paths already carry the case on disk, so only
 * the separator style and the drive letter, which never has case, change.
 */
export const pathKey = (path: string, platform: CanonicalPathPlatform): string => {
  if (platform === "posix") return path.length > 1 ? path.replace(/\/+$/, "") : path;
  const key = path
    .replaceAll("\\", "/")
    .replace(/^([a-zA-Z]):/, (_, drive: string) => `${drive.toUpperCase()}:`);
  return /^[A-Z]:\/$/.test(key) ? key : key.replace(/\/+$/, "");
};

/** True when the key of `child` is the key of `parent` or a path below it. */
export const keyContains = (parentKey: string, childKey: string): boolean =>
  childKey === parentKey ||
  childKey.startsWith(parentKey.endsWith("/") ? parentKey : `${parentKey}/`);

/** The parent directory, or null at the file system root. */
export const parentDirectory = (path: string, platform: CanonicalPathPlatform): string | null => {
  const trimmed =
    path.length > 1 ? path.replace(platform === "windows" ? /[\\/]+$/ : /\/+$/, "") : path;
  const index =
    platform === "windows"
      ? Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"))
      : trimmed.lastIndexOf("/");
  if (index < 0) return null;
  const parent = trimmed.slice(0, index);
  if (platform === "posix") return index === 0 ? (trimmed === "/" ? null : "/") : parent;
  // A Windows drive root keeps its separator, such as `C:\`.
  if (/^[A-Za-z]:$/.test(parent)) return trimmed.length === 3 ? null : `${parent}\\`;
  return parent;
};
