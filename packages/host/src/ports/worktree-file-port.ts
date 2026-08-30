import { Context, type Effect } from "effect";
import type {
  HostOperationErrorAggregate,
  HostValidationErrorAggregate,
} from "../effect/host-errors";

export type WorktreeFileError = HostOperationErrorAggregate | HostValidationErrorAggregate;

export type ResolvedPathWithinRoot =
  | { canonicalPath: string; cleanupPath: string; isSymlink: boolean; kind: "descendant" }
  | { canonicalPath: string; cleanupPath: string; isSymlink: boolean; kind: "outside" };

export type WorktreeFilePort = {
  ensureDirectory(path: string): Effect.Effect<void, HostOperationErrorAggregate>;
  copyConfiguredPaths(
    repoPath: string,
    worktreePath: string,
    relativePaths: string[],
  ): Effect.Effect<void, WorktreeFileError>;
  removePathIfPresent(path: string): Effect.Effect<void, HostOperationErrorAggregate>;
  resolveWorktreePath(repoPath: string, worktreePath: string): string;
  resolvePathWithinRoot(
    root: string,
    candidate: string,
  ): Effect.Effect<ResolvedPathWithinRoot, HostOperationErrorAggregate>;
  pathIsWithinRoot(root: string, candidate: string): Effect.Effect<boolean, WorktreeFileError>;
};

export class WorktreeFilePortTag extends Context.Tag("@openducktor/host/WorktreeFilePort")<
  WorktreeFilePortTag,
  WorktreeFilePort
>() {}
