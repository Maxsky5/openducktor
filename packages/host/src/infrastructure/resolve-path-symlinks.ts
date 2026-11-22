import { realpathSync } from "node:fs";
import path from "node:path";

/** Resolves existing ancestors so paths that have not been created can still be compared. */
export function resolvePathSymlinks(target: string, tail: string[] = []): string {
  const fullPath = path.resolve(target);
  try {
    return path.join(realpathSync.native(fullPath), ...tail);
  } catch (cause) {
    if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) {
      throw cause;
    }
    const parent = path.dirname(fullPath);
    if (parent === fullPath) throw cause;
    return resolvePathSymlinks(parent, [path.basename(fullPath), ...tail]);
  }
}
