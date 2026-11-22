import { realpathSync } from "node:fs";
import path from "node:path";

type PathSymlinkParts = {
  existingPath: string;
  remainingPath: string;
};

/** Resolves the nearest existing path and retains the path below it. */
export function resolvePathSymlinkParts(target: string): PathSymlinkParts {
  let candidate = path.resolve(target);
  let remainingPath = "";
  for (;;) {
    try {
      return { existingPath: realpathSync.native(candidate), remainingPath };
    } catch (cause) {
      if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) {
        throw cause;
      }
      const parent = path.dirname(candidate);
      if (parent === candidate) throw cause;
      remainingPath = path.join(path.basename(candidate), remainingPath);
      candidate = parent;
    }
  }
}

export function resolvePathSymlinks(target: string): string {
  const { existingPath, remainingPath } = resolvePathSymlinkParts(target);
  return path.join(existingPath, remainingPath);
}
