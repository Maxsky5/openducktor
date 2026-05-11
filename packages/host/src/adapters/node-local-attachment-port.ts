import { mkdir, readdir, realpath, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { LocalAttachmentEntry, LocalAttachmentPort } from "../ports/local-attachment-port";

const localAttachmentStageDirName = "openducktor-local-attachments";

export const createNodeLocalAttachmentPort = (): LocalAttachmentPort => ({
  stageDirectory() {
    return path.join(os.tmpdir(), localAttachmentStageDirName);
  },
  joinPath(...segments) {
    return path.join(...segments);
  },
  relativePath(from, to) {
    return path.relative(from, to);
  },
  isAbsolutePath(inputPath) {
    return path.isAbsolute(inputPath);
  },
  canonicalizePath(inputPath) {
    return realpath(inputPath);
  },
  async ensureDirectory(inputPath) {
    await mkdir(inputPath, { recursive: true });
  },
  writeFile(inputPath, bytes) {
    return writeFile(inputPath, bytes);
  },
  async readDirectory(inputPath) {
    const entries = await readdir(inputPath, { withFileTypes: true });
    return entries.map(
      (entry): LocalAttachmentEntry => ({
        path: path.join(inputPath, entry.name),
        fileName: entry.name,
      }),
    );
  },
  async modifiedTimeMs(inputPath) {
    const metadata = await stat(inputPath);
    return metadata.mtimeMs;
  },
  async exists(inputPath) {
    try {
      await stat(inputPath);
      return true;
    } catch {
      return false;
    }
  },
});
