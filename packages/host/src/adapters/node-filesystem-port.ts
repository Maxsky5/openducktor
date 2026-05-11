import { access, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { FilesystemDirectoryEntry, FilesystemPort } from "../ports/filesystem-port";

export const createNodeFilesystemPort = (): FilesystemPort => ({
  homeDirectory() {
    const home = homedir();
    return home.trim().length > 0 ? home : null;
  },
  canonicalize(inputPath) {
    return realpath(inputPath);
  },
  async readDirectory(inputPath) {
    const entries = await readdir(inputPath, { withFileTypes: true });
    return entries.map(
      (entry): FilesystemDirectoryEntry => ({
        name: entry.name,
        path: path.join(inputPath, entry.name),
      }),
    );
  },
  async stat(inputPath) {
    const metadata = await stat(inputPath);
    return {
      isDirectory: metadata.isDirectory(),
    };
  },
  async exists(inputPath) {
    try {
      await access(inputPath);
      return true;
    } catch {
      return false;
    }
  },
  join(...paths) {
    return path.join(...paths);
  },
  parent(inputPath) {
    const parentPath = path.dirname(inputPath);
    return parentPath === inputPath ? null : parentPath;
  },
});
