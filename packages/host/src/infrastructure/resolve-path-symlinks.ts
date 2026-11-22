import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";

type PathSymlinkParts = {
  existingPath: string;
  remainingPath: string;
};

// Preserve parent segments in symlink targets until the filesystem resolves them.
const appendPath = (parent: string, child: string): string =>
  `${parent}${parent.endsWith(path.sep) ? "" : path.sep}${child}`;

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
      const { dir: parent, base } = path.parse(candidate);
      if (!base) throw cause;
      const entry = appendPath(parent, base);
      if (lstatSync(entry, { throwIfNoEntry: false })?.isSymbolicLink()) {
        const destination = readlinkSync(entry);
        candidate = path.isAbsolute(destination)
          ? destination
          : appendPath(realpathSync.native(parent), destination);
        continue;
      }
      remainingPath = path.join(base, remainingPath);
      candidate = parent;
    }
  }
}

export function resolvePathSymlinks(target: string): string {
  const { existingPath, remainingPath } = resolvePathSymlinkParts(target);
  return path.join(existingPath, remainingPath);
}
