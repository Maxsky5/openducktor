import { type DirectoryListing, directoryListingSchema } from "@openducktor/contracts";
import type { FilesystemPort } from "../ports/filesystem-port";

export type FilesystemListDirectoryErrorKind =
  | "home_directory_unavailable"
  | "invalid_path"
  | "directory_does_not_exist"
  | "path_is_not_directory"
  | "read_failed";

export class FilesystemListDirectoryError extends Error {
  readonly kind: FilesystemListDirectoryErrorKind;

  constructor(kind: FilesystemListDirectoryErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FilesystemListDirectoryError";
    this.kind = kind;
  }
}

export type FilesystemListDirectoryInput = {
  path?: string;
};

export type FilesystemService = {
  listDirectory(input?: FilesystemListDirectoryInput): Promise<DirectoryListing>;
};

const hasNodeErrorCode = (error: unknown, code: string): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === code;

const stripMatchingQuotes = (value: string): string => {
  if (value.length < 2) {
    return value;
  }

  const first = value.at(0);
  const last = value.at(-1);
  if ((first === `"` && last === `"`) || (first === `'` && last === `'`)) {
    return value.slice(1, -1);
  }

  return value;
};

const resolveHome = (filesystem: FilesystemPort): string => {
  const home = filesystem.homeDirectory();
  if (home) {
    return home;
  }

  throw new FilesystemListDirectoryError(
    "home_directory_unavailable",
    "Unable to resolve the user home directory.",
  );
};

const resolveUserPath = (filesystem: FilesystemPort, rawPath: string): string => {
  const trimmedPath = rawPath.trim();
  if (!trimmedPath) {
    throw new FilesystemListDirectoryError("invalid_path", "Path is empty; provide a valid path");
  }

  const unquotedPath = stripMatchingQuotes(trimmedPath);
  if (!unquotedPath) {
    throw new FilesystemListDirectoryError("invalid_path", "Path is empty; provide a valid path");
  }

  if (unquotedPath === "~") {
    return resolveHome(filesystem);
  }

  const homeRelativePrefix = unquotedPath.startsWith("~/")
    ? "~/"
    : unquotedPath.startsWith("~\\")
      ? "~\\"
      : null;
  if (!homeRelativePrefix) {
    return unquotedPath;
  }

  return filesystem.join(resolveHome(filesystem), unquotedPath.slice(homeRelativePrefix.length));
};

const resolveRequestedPath = (filesystem: FilesystemPort, rawPath: string | undefined): string => {
  if (rawPath !== undefined) {
    return resolveUserPath(filesystem, rawPath);
  }

  return resolveHome(filesystem);
};

const canonicalizeDirectory = async (
  filesystem: FilesystemPort,
  requestedPath: string,
): Promise<string> => {
  let currentPath: string;
  try {
    currentPath = await filesystem.canonicalize(requestedPath);
  } catch (error) {
    if (hasNodeErrorCode(error, "ENOENT")) {
      throw new FilesystemListDirectoryError(
        "directory_does_not_exist",
        `Directory does not exist: ${requestedPath}`,
        { cause: error },
      );
    }

    throw new FilesystemListDirectoryError(
      "read_failed",
      `Failed to read directory '${requestedPath}': ${String(error)}`,
      { cause: error },
    );
  }

  const metadata = await filesystem.stat(currentPath).catch((error: unknown) => {
    throw new FilesystemListDirectoryError(
      "read_failed",
      `Failed to read directory '${currentPath}': ${String(error)}`,
      { cause: error },
    );
  });

  if (!metadata.isDirectory) {
    throw new FilesystemListDirectoryError(
      "path_is_not_directory",
      `Path is not a directory: ${currentPath}`,
    );
  }

  return currentPath;
};

const readDirectoryEntries = async (filesystem: FilesystemPort, currentPath: string) => {
  const entries = await filesystem.readDirectory(currentPath).catch((error: unknown) => {
    throw new FilesystemListDirectoryError(
      "read_failed",
      `Failed to read directory '${currentPath}': ${String(error)}`,
      { cause: error },
    );
  });

  const directories = [];
  for (const entry of entries) {
    const metadata = await filesystem.stat(entry.path).catch((error: unknown) => {
      throw new FilesystemListDirectoryError(
        "read_failed",
        `Failed to read directory '${currentPath}': ${String(error)}`,
        { cause: error },
      );
    });

    if (!metadata.isDirectory) {
      continue;
    }

    directories.push({
      name: entry.name,
      path: entry.path,
      isDirectory: true,
      isGitRepo: await filesystem.exists(filesystem.join(entry.path, ".git")),
    });
  }

  directories.sort((left, right) => {
    const insensitive = left.name.toLowerCase().localeCompare(right.name.toLowerCase());
    return insensitive === 0 ? left.name.localeCompare(right.name) : insensitive;
  });

  return directories;
};

export const createFilesystemService = (filesystem: FilesystemPort): FilesystemService => ({
  async listDirectory(input) {
    const requestedPath = resolveRequestedPath(filesystem, input?.path);
    const currentPath = await canonicalizeDirectory(filesystem, requestedPath);
    const home = filesystem.homeDirectory();
    const homePath = home ? await filesystem.canonicalize(home).catch(() => home) : null;
    const listing = {
      currentPath,
      currentPathIsGitRepo: await filesystem.exists(filesystem.join(currentPath, ".git")),
      parentPath: filesystem.parent(currentPath),
      homePath,
      entries: await readDirectoryEntries(filesystem, currentPath),
    };

    return directoryListingSchema.parse(listing);
  },
});
