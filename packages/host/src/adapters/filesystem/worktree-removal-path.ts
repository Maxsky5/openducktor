import type { Stats } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
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
      throw new Error(
        `Cannot verify dangling worktree alias ${absolutePath}. Inspect the alias and remove it manually only if it still belongs to the removed worktree, then retry archive. Turn off worktree removal to archive without deleting it.`,
      );
    }
    const parent = path.dirname(absolutePath);
    if (parent === absolutePath) throw cause;
    const resolvedParent = await resolveRemovalPath(parent);
    try {
      const parentStats = await lstat(resolvedParent);
      if (!parentStats.isDirectory()) {
        throw new Error(`ENOTDIR: ${resolvedParent} is not a directory.`);
      }
    } catch (error) {
      if (!hasNestedNodeErrorCode(error, "ENOENT")) throw error;
    }
    return path.join(resolvedParent, path.basename(absolutePath));
  }
};

// Absent paths permit partial-removal retries. Dangling links do not prove the original identity.
export const resolveWorktreeRemovalPath: WorktreeFilePort["resolveWorktreeRemovalPath"] = (
  inputPath,
) =>
  Effect.tryPromise({
    try: () => resolveRemovalPath(inputPath),
    catch: (cause) => toHostOperationError(cause, "worktreeFile.resolveRemovalPath", { inputPath }),
  });
