import { Buffer } from "node:buffer";
import { constants as fsConstants } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";

export const isPathWithinRoot = (
  candidate: string,
  root: string,
  options: { allowEqual?: boolean } = {},
): boolean => {
  const normalizedCandidate = path.resolve(candidate);
  const normalizedRoot = path.resolve(root);
  if (normalizedCandidate === normalizedRoot) {
    return options.allowEqual === true;
  }
  const prefix = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : `${normalizedRoot}${path.sep}`;
  return normalizedCandidate.startsWith(prefix);
};

export type ReadRegularFileResult =
  | { kind: "ok"; bytes: Buffer; size: number }
  | { kind: "too_large"; size: number }
  | { kind: "symlink" }
  | { kind: "hardlink" }
  | { kind: "missing" }
  | { kind: "unreadable"; cause?: unknown };

export const readRegularFileNoFollow = (
  filePath: string,
  options: { maxBytes: number; requireSingleLink: boolean },
): Effect.Effect<ReadRegularFileResult> =>
  Effect.promise(async (): Promise<ReadRegularFileResult> => {
    let handle: FileHandle | undefined;
    try {
      // Windows does not define O_NOFOLLOW; check lstat before open so symlinks are rejected on
      // every platform while POSIX still enforces O_NOFOLLOW atomically on open.
      const entry = await lstat(filePath);
      if (entry.isSymbolicLink()) return { kind: "symlink" };
      const flags =
        fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0);
      handle = await open(filePath, flags);
      const info = await handle.stat();
      if (!info.isFile()) return { kind: "unreadable" };
      if (options.requireSingleLink && info.nlink !== 1) return { kind: "hardlink" };
      if (info.size > options.maxBytes) return { kind: "too_large", size: info.size };
      const buffer = Buffer.alloc(info.size);
      let filled = 0;
      while (filled < buffer.length) {
        const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, filled);
        if (bytesRead === 0) break;
        filled += bytesRead;
      }
      return { kind: "ok", bytes: buffer.subarray(0, filled), size: filled };
    } catch (cause) {
      if (cause instanceof Error && "code" in cause) {
        if (cause.code === "ELOOP") return { kind: "symlink" };
        if (cause.code === "ENOENT") return { kind: "missing" };
      }
      return { kind: "unreadable", cause };
    } finally {
      await handle?.close().catch(() => {});
    }
  });
