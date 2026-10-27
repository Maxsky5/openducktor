import { isAbsolute } from "node:path";
import { Effect } from "effect";
import { canonicalPathsEqual } from "../../domain/path-comparison";
import type { HostOperationErrorAggregate } from "../../effect/host-errors";
import type { FilesystemPort } from "../../ports/filesystem-port";

export type CodexDirectoryMatcher = (
  left: string,
  right: string,
) => Effect.Effect<boolean, HostOperationErrorAggregate>;

export const createCodexDirectoryMatcher =
  (filesystem: Pick<FilesystemPort, "canonicalize">): CodexDirectoryMatcher =>
  (left, right) => {
    // Saved sessions can outlive their worktree when both paths are unchanged.
    if (left === right) return Effect.succeed(true);
    if (!isAbsolute(left) || !isAbsolute(right)) return Effect.succeed(false);
    return Effect.gen(function* () {
      const canonicalLeft = yield* filesystem.canonicalize(left);
      const canonicalRight = yield* filesystem.canonicalize(right);
      return canonicalPathsEqual(
        canonicalLeft,
        canonicalRight,
        process.platform === "win32" ? "windows" : "posix",
      );
    });
  };
