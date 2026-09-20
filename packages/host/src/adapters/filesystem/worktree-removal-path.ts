import type { Stats } from "node:fs";
import { lstat, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import { hasNestedNodeErrorCode, toHostOperationError } from "../../effect/host-errors";
import type { WorktreeFilePort } from "../../ports/worktree-file-port";

const resolveRemovalPath = async (inputPath: string): Promise<string> => {
  try {
    return await realpath(inputPath);
  } catch (cause) {
    if (!hasNestedNodeErrorCode(cause, "ENOENT")) throw cause;
    const absolutePath = path.resolve(inputPath);
    let stats: Stats | null;
    try {
      stats = await lstat(absolutePath);
    } catch (error) {
      if (!hasNestedNodeErrorCode(error, "ENOENT")) throw error;
      stats = null;
    }
    if (stats?.isSymbolicLink()) {
      const target = await readlink(absolutePath);
      return resolveRemovalPath(path.resolve(path.dirname(absolutePath), target));
    }
    const parent = path.dirname(absolutePath);
    if (parent === absolutePath) throw cause;
    return path.join(await resolveRemovalPath(parent), path.basename(absolutePath));
  }
};

// Missing paths are expected after a confirmed partial removal. Other errors must fail it.
export const resolveWorktreeRemovalPath: WorktreeFilePort["resolveWorktreeRemovalPath"] = (
  inputPath,
) =>
  Effect.tryPromise({
    try: () => resolveRemovalPath(inputPath),
    catch: (cause) => toHostOperationError(cause, "worktreeFile.resolveRemovalPath", { inputPath }),
  });
