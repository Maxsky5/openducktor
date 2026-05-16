import type { Effect } from "effect";
import type { HostOperationError, HostValidationError } from "../effect/host-errors";

export type WorktreeFileError = HostOperationError | HostValidationError;

export type WorktreeFilePort = {
  ensureDirectory?(path: string): Effect.Effect<void, HostOperationError>;
  copyConfiguredPaths(
    repoPath: string,
    worktreePath: string,
    relativePaths: string[],
  ): Effect.Effect<void, WorktreeFileError>;
  removePathIfPresent(path: string): Effect.Effect<void, HostOperationError>;
  resolveWorktreePath(repoPath: string, worktreePath: string): string;
  pathIsWithinRoot(root: string, candidate: string): Effect.Effect<boolean, WorktreeFileError>;
};
