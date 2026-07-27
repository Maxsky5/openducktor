import { Context, type Effect } from "effect";
import type { HostOperationError, HostValidationError } from "../effect/host-errors";

export type WorktreeFileError = HostOperationError | HostValidationError;

export type ResolvedPathWithinRoot =
  | { canonicalPath: string; kind: "descendant" }
  | { canonicalPath: string; kind: "outside" };

export type WorktreeFilePort = {
  ensureDirectory(path: string): Effect.Effect<void, HostOperationError>;
  copyConfiguredPaths(
    repoPath: string,
    worktreePath: string,
    relativePaths: string[],
  ): Effect.Effect<void, WorktreeFileError>;
  removePathIfPresent(path: string): Effect.Effect<void, HostOperationError>;
  resolveWorktreePath(repoPath: string, worktreePath: string): string;
  resolvePathWithinRoot(
    root: string,
    candidate: string,
  ): Effect.Effect<ResolvedPathWithinRoot, HostOperationError>;
  pathIsWithinRoot(root: string, candidate: string): Effect.Effect<boolean, WorktreeFileError>;
};

export class WorktreeFilePortTag extends Context.Tag("@openducktor/host/WorktreeFilePort")<
  WorktreeFilePortTag,
  WorktreeFilePort
>() {}
