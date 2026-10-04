import { lstat, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import { errorMessage, hasNestedNodeErrorCode, HostOperationError } from "../../effect/host-errors";

const resolvePath = async (
  inputPath: string,
  resolvingLinks = new Set<string>(),
): Promise<string> => {
  const absolutePath = path.resolve(inputPath);
  try {
    return await realpath(absolutePath);
  } catch (cause) {
    const parentPath = path.dirname(absolutePath);
    if (!hasNestedNodeErrorCode(cause, "ENOENT") || parentPath === absolutePath) {
      throw cause;
    }
    const resolvedParent = await resolvePath(parentPath, resolvingLinks);
    const candidate = path.join(resolvedParent, path.basename(absolutePath));
    const entry = await lstat(candidate).catch((cause: unknown) => {
      if (hasNestedNodeErrorCode(cause, "ENOENT")) return null;
      throw cause;
    });
    if (entry?.isSymbolicLink()) {
      if (resolvingLinks.has(candidate)) {
        throw new Error(`Symlink loop at ${candidate}`);
      }
      const target = await readlink(candidate);
      resolvingLinks.add(candidate);
      try {
        return await resolvePath(path.resolve(resolvedParent, target), resolvingLinks);
      } finally {
        resolvingLinks.delete(candidate);
      }
    }
    return candidate;
  }
};

export const resolveWorkspaceLifecyclePath = (repoPath: string) =>
  Effect.tryPromise({
    try: () => resolvePath(repoPath),
    catch: (cause) =>
      new HostOperationError({
        operation: "settingsConfig.resolveWorkspaceLifecyclePath",
        message: `Cannot resolve workspace path ${repoPath}: ${errorMessage(cause)}. Restore path access or fix the symlink and retry.`,
        cause,
        details: { path: repoPath },
      }),
  });
